import { shouldSkipFile } from "../diffs";

export type TreeFile = { path: string; size?: number; sha?: string };
export type RankedFile = TreeFile & { score: number; entry: boolean };
export type Signals = { referenced: Map<string, number>; churn: Map<string, number> };

export const MAX_FILE_BYTES = 100_000;

export const SOURCE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|cs|php|exs?|vue|svelte|scala)$/;
const TEST = /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|fixtures)\/|\.(test|spec)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
export const ENTRY = /(^|\/)(index|main|app|server|cli|mod|lib)\.(tsx?|jsx?|mjs|py|go|rs)$|(^|\/)app\/(page|layout)\.(tsx|jsx)$/;
const HIGH = new Set(["src", "lib", "app", "cmd", "internal", "core", "server", "api", "pkg"]);
const LOW = new Set(["examples", "example", "scripts", "script", "migrations", "generated", "vendor", "third_party", "benchmarks", "bench", "docs", "demo", "demos", "samples", "tools", "stories"]);

export const isSourceFile = (f: TreeFile) =>
  SOURCE.test(f.path) && !f.path.endsWith(".d.ts") && !TEST.test(f.path) && !shouldSkipFile(f.path) && (f.size ?? 0) <= MAX_FILE_BYTES;

function pathWeight(path: string): number {
  const dirs = path.split("/").slice(0, -1);
  if (dirs.some((d) => LOW.has(d)) || /\.(stories|config)\.[^/]+$/.test(path)) return -3;
  if (dirs.some((d) => HIGH.has(d))) return 2;
  return 0;
}

/**
 * score = pathWeight (+2 src/lib/app/cmd/internal/…, -3 examples/scripts/migrations/generated/vendor/…, 0 otherwise)
 *       + 4 if it looks like an entry point (index/main/app/server/cli/mod/lib, app/page|layout)
 *       + 1.5 * log2(1 + in-degree)   (imports pointing at it from the entry points and manifests we already read)
 *       + 1.5 * log2(1 + churn)       (times it was touched in the last ~15 commits)
 *       + min(1, bytes / 4000)        (a little credit for substance; tiny re-export files rank lower)
 *       - 0.3 * path depth
 * Tests, .d.ts, generated/lock/build output (shouldSkipFile) and files over 100 KB are dropped.
 */
export function rankFiles(tree: TreeFile[], { referenced, churn }: Signals): RankedFile[] {
  return tree
    .filter(isSourceFile)
    .map((f) => {
      const entry = ENTRY.test(f.path);
      const score =
        pathWeight(f.path) +
        (entry ? 4 : 0) +
        1.5 * Math.log2(1 + (referenced.get(f.path) ?? 0)) +
        1.5 * Math.log2(1 + (churn.get(f.path) ?? 0)) +
        Math.min(1, (f.size ?? 0) / 4000) -
        0.3 * f.path.split("/").length;
      return { ...f, entry, score };
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

const EXT = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|rb|vue|svelte)$/;
const INDEX = /\/(index|__init__|mod)$/;

function normalise(parts: string[]): string {
  const out: string[] = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") out.pop();
    else out.push(p);
  }
  return out.join("/");
}

const dirOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");

function specifiers(path: string, content: string): string[] {
  const dir = dirOf(path);
  const out: string[] = [];
  const add = (spec: string, relativeTo = dir) => {
    let s = spec.replace(EXT, "");
    if (s.startsWith("@/") || s.startsWith("~/")) s = `src/${s.slice(2)}`;
    else if (s.startsWith(".")) s = normalise([...relativeTo.split("/"), ...s.split("/")]);
    out.push(s);
  };
  if (/(^|\/)package\.json$/.test(path)) {
    for (const m of content.matchAll(/"(\.?\.?\/?[\w@./-]+\.(?:m?[jt]sx?|cjs))"/g)) add(m[1].startsWith(".") ? m[1] : `./${m[1]}`);
    return out;
  }
  if (/(^|\/)pyproject\.toml$/.test(path)) {
    for (const m of content.matchAll(/["']([\w.]+):\w+["']/g)) out.push(m[1].replaceAll(".", "/"));
    return out;
  }
  for (const m of content.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*|\brequire\(\s*)["']([^"'\n]+)["']/g)) add(m[1]);
  for (const m of content.matchAll(/^\s*(?:from|import)\s+([A-Za-z_][\w.]*)/gm)) out.push(m[1].replaceAll(".", "/"));
  return out;
}

/** In-degree of tree files, counted from imports and manifest fields in already-fetched files (one count per importer). */
export function referencedCounts(paths: string[], sources: { path: string; content: string }[]): Map<string, number> {
  const byKey = new Map<string, string>();
  for (const p of paths) {
    const key = p.replace(EXT, "");
    if (!byKey.has(key)) byKey.set(key, p);
    if (INDEX.test(key) && !byKey.has(key.replace(INDEX, ""))) byKey.set(key.replace(INDEX, ""), p);
  }
  const counts = new Map<string, number>();
  for (const src of sources) {
    const hits = new Set<string>();
    for (const spec of specifiers(src.path, src.content)) {
      const hit = byKey.get(spec);
      if (hit && hit !== src.path) hits.add(hit);
    }
    for (const h of hits) counts.set(h, (counts.get(h) ?? 0) + 1);
  }
  return counts;
}

const CONTAINERS = new Set(["packages", "apps", "services", "libs", "modules", "crates", "plugins", "src", "cmd", "internal", "pkg"]);

/** Module = first path segment, or first two for monorepo containers like packages/* and src/*. */
export function moduleOf(path: string): string {
  const dirs = path.split("/").slice(0, -1);
  if (dirs.length === 0) return ".";
  return CONTAINERS.has(dirs[0]) && dirs.length >= 2 ? `${dirs[0]}/${dirs[1]}` : dirs[0];
}

/**
 * Round-robin the best files of each module (best modules first) so the picks have breadth, not one deep corner.
 * With `fill`, leftover slots go to the best remaining files regardless of module.
 */
export function pickModuleFiles<T extends RankedFile>(
  ranked: T[],
  {
    perModule = 6,
    total = 60,
    fill = false,
    moduleKey = (f: T) => moduleOf(f.path),
  }: { perModule?: number; total?: number; fill?: boolean; moduleKey?: (f: T) => string } = {},
): T[] {
  const groups = new Map<string, T[]>();
  for (const f of ranked) {
    const g = groups.get(moduleKey(f)) ?? [];
    if (g.length < perModule) g.push(f);
    groups.set(moduleKey(f), g);
  }
  const ordered = [...groups.values()].sort(
    (a, b) => b.reduce((s, f) => s + f.score, 0) - a.reduce((s, f) => s + f.score, 0),
  );
  const out: T[] = [];
  for (let round = 0; round < perModule && out.length < total; round++) {
    for (const g of ordered) {
      if (out.length >= total) break;
      if (g[round]) out.push(g[round]);
    }
  }
  if (fill && out.length < total) {
    const taken = new Set(out);
    out.push(...ranked.filter((f) => !taken.has(f)).slice(0, total - out.length));
  }
  return out;
}
