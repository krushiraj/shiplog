import { ProjectConfigSchema, resolveConfig, type PartialConfig, type ProjectConfig } from "@/lib/config";

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === "object" && v !== null && !Array.isArray(v);

function deepMerge(base: unknown, patch: unknown): unknown {
  if (patch === undefined) return base;
  if (!isPlain(base) || !isPlain(patch)) return structuredClone(patch);
  const out: Plain = { ...base };
  for (const [k, v] of Object.entries(patch)) out[k] = deepMerge(base[k], v);
  return out;
}

/** The leaves of `next` that differ from `base`, as a nested partial object. */
export function diffOverrides(base: unknown, next: unknown): Plain {
  const out: Plain = {};
  if (!isPlain(next)) return out;
  for (const [k, v] of Object.entries(next)) {
    const b = isPlain(base) ? base[k] : undefined;
    if (isPlain(v)) {
      const sub = diffOverrides(b, v);
      if (Object.keys(sub).length) out[k] = sub;
    } else if (JSON.stringify(v) !== JSON.stringify(b)) out[k] = v;
  }
  return out;
}

export type PatchResult =
  | { ok: true; config: ProjectConfig; overrides: PartialConfig }
  | { ok: false; issues: string[] };

/**
 * Applies a partial settings patch on top of the project's effective config, validates the
 * result, and returns only what differs from the inherited (defaults + user) layer.
 */
export function applyConfigPatch(layers: { user: PartialConfig; project: PartialConfig }, patch: unknown): PatchResult {
  const inherited = resolveConfig(layers.user, {});
  const current = resolveConfig(layers.user, layers.project);
  const parsed = ProjectConfigSchema.safeParse(deepMerge(current, patch));
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  return { ok: true, config: parsed.data, overrides: diffOverrides(inherited, parsed.data) as PartialConfig };
}
