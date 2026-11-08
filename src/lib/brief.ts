import { and, eq, inArray } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db";
import { fileSummaries, projectRepos, projects } from "@/db/schema";
import { AiBudgetError } from "./ai/budget";
import { callJson as defaultCallJson } from "./ai/claude";
import { estimateTokens } from "./ai/pricing";
import { briefFileSummariesPrompt, briefPrompt } from "./ai/prompts";
import { BriefSchema, FileSummarySchema, type Brief } from "./ai/schemas";
import { MAX_INPUT_TOKENS, clip, shrinkLevels, type Shrink } from "./brief/budget";
import { fetchTree, recentChurn } from "./brief/github";
import { outlineTree } from "./brief/outline";
import { deadline, mapLimit, within } from "./brief/pool";
import { ModuleSummarySchema, moduleSummariesPrompt } from "./brief/prompts";
import { ENTRY, isSourceFile, moduleOf, pickModuleFiles, rankFiles, referencedCounts, type RankedFile, type Signals, type TreeFile } from "./brief/rank";
import type { BriefBuildStatus } from "./brief/status";
import { shouldSkipFile } from "./diffs";
import { installationOctokit, type GitHub } from "./github/app";
import { scrub } from "./scrub";

export type { BriefBuildStatus, TreeFile };

export const briefProgress = ["Reading README", "Mapping modules", "Building glossary", "Done"] as const;
export type BriefStep = (typeof briefProgress)[number];

export const SUMMARY_MODEL = "claude-haiku-5-5";

export type SummaryRow = { repoFullName: string; path: string; blobSha: string; summary: string; model: string };

export type BriefStore = {
  getProject(projectId: string): Promise<{
    brief: Record<string, unknown> | null;
    repos: { repoFullName: string; installationId: number }[];
    userId?: string | null;
    name?: string | null;
    isDemo?: boolean;
  } | null>;
  saveBrief(projectId: string, brief: Record<string, unknown>): Promise<void>;
  saveStatus?(projectId: string, status: BriefBuildStatus): Promise<void>;
  /** path → summary for the files whose (path, sha) is cached. */
  cachedSummaries?(repoFullName: string, files: { path: string; sha: string }[]): Promise<Map<string, string>>;
  saveSummaries?(rows: SummaryRow[]): Promise<void>;
};

export type BriefDeps = {
  store: BriefStore;
  github: (installationId: number) => Promise<GitHub>;
  callJson: typeof defaultCallJson;
  onProgress?: (step: BriefStep) => void;
  timeBudgetMs?: number;
  now?: () => number;
};

export function drizzleBriefStore(database: Db = defaultDb): BriefStore {
  return {
    async getProject(projectId) {
      const [project] = await database
        .select({ brief: projects.brief, userId: projects.userId, name: projects.name, isDemo: projects.isDemo })
        .from(projects)
        .where(eq(projects.id, projectId))
        .limit(1);
      if (!project) return null;
      const repos = await database
        .select({ repoFullName: projectRepos.repoFullName, installationId: projectRepos.installationId })
        .from(projectRepos)
        .where(eq(projectRepos.projectId, projectId));
      return { ...project, repos };
    },
    async saveBrief(projectId, brief) {
      await database.update(projects).set({ brief }).where(eq(projects.id, projectId));
    },
    async saveStatus(projectId, status) {
      await database.update(projects).set({ briefStatus: status }).where(eq(projects.id, projectId));
    },
    async cachedSummaries(repoFullName, files) {
      if (files.length === 0) return new Map();
      const wanted = new Map(files.map((f) => [f.path, f.sha]));
      const rows = await database
        .select({ path: fileSummaries.path, blobSha: fileSummaries.blobSha, summary: fileSummaries.summary })
        .from(fileSummaries)
        .where(and(eq(fileSummaries.repoFullName, repoFullName), inArray(fileSummaries.path, [...wanted.keys()])));
      return new Map(rows.filter((r) => wanted.get(r.path) === r.blobSha).map((r) => [r.path, r.summary]));
    },
    async saveSummaries(rows) {
      if (rows.length) await database.insert(fileSummaries).values(rows).onConflictDoNothing();
    },
  };
}

const SMALL_KEY_FILES = 40;
const SMALL_PER_MODULE = 10;
const BIG_KEY_FILES = 60;
const PER_MODULE = 6;
const BIG_REPO_FILES = 2000;
const BIG_REPO_COUNT = 3;
const ENTRY_READS = 10;
const MAX_DOCS = 10;
const BATCH = 10;
const CONCURRENCY = 4;
const MODULES_PER_CALL = 5;
const TIME_BUDGET_MS = 240_000;
const MANIFESTS = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"];

const NO_SIGNALS: Signals = { referenced: new Map(), churn: new Map() };

export function pickKeyFiles(tree: TreeFile[], max = SMALL_KEY_FILES, signals = NO_SIGNALS): string[] {
  return rankFiles(tree, signals).slice(0, max).map((f) => f.path);
}

const decode = (content: string) => Buffer.from(content, "base64").toString("utf8");
const depth = (p: string) => p.split("/").length;
const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function readFile(gh: GitHub, owner: string, repo: string, path: string, ref: string, limit: number): Promise<string | null> {
  try {
    const { data } = await gh.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    return scrub(clip(decode(data.content), limit));
  } catch {
    return null;
  }
}

type Doc = { path: string; content: string };

type RepoMaterial = {
  repoFullName: string;
  read: (paths: string[], limit: number) => Promise<Doc[]>;
  readme: string | null;
  docs: Doc[];
  manifests: Doc[];
  ranked: RankedFile[];
  outlinePaths: string[];
  prefetched: Map<string, string>;
};

const MAX = shrinkLevels[0];

async function readRepo(gh: GitHub, repoFullName: string): Promise<RepoMaterial> {
  const [owner, repo] = repoFullName.split("/");
  const { data: info } = await gh.rest.repos.get({ owner, repo });
  const ref = info.default_branch;
  const tree = await fetchTree(gh, owner, repo, ref);
  const paths = tree.files.map((f) => f.path);

  const read = async (list: string[], limit: number) =>
    (await mapLimit(list, 10, async (path) => ({ path, content: await readFile(gh, owner, repo, path, ref, limit) }))).filter(
      (f): f is Doc => f.content !== null,
    );

  const entryPaths = tree.files
    .filter((f) => isSourceFile(f) && ENTRY.test(f.path))
    .map((f) => f.path)
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .slice(0, ENTRY_READS);
  const [readme, docs, manifests, entries, churn] = await Promise.all([
    gh.rest.repos.getReadme({ owner, repo, ref }).then(({ data }) => scrub(clip(decode(data.content), MAX.readmeClip)), () => null),
    read(paths.filter((p) => /^docs\/.+\.md$/i.test(p)).sort().slice(0, MAX_DOCS), MAX.docClip),
    read(paths.filter((p) => MANIFESTS.includes(p)), MAX.manifestClip),
    read(entryPaths, MAX.fileClip),
    recentChurn(gh, owner, repo, ref),
  ]);

  const referenced = referencedCounts(paths, [...entries, ...manifests]);
  return {
    repoFullName,
    read,
    readme,
    docs,
    manifests,
    ranked: rankFiles(tree.files, { referenced, churn }),
    outlinePaths: [...paths.filter((p) => !shouldSkipFile(p)), ...tree.dirs],
    prefetched: new Map(entries.map((e) => [e.path, e.content])),
  };
}

type KeyFile = RankedFile & { repo: RepoMaterial; label: string; module: string; content?: string };
type Summary = { path: string; summary: string };

const PLACEHOLDER_SUMMARY = "x".repeat(160);

function fallbackBrief(material: RepoMaterial[], summaries: Summary[]): Brief {
  const lines = (material.find((m) => m.readme)?.readme ?? "").split("\n").map((l) => l.trim()).filter(Boolean);
  const title = lines.find((l) => l.startsWith("#"))?.replace(/^#+\s*/, "");
  const para = lines.find((l) => !l.startsWith("#") && !l.startsWith("!["));
  const pitch = [title, para].filter(Boolean).join(": ") || material.map((m) => m.repoFullName).join(", ");
  return {
    pitch: pitch.slice(0, 300),
    audience: "",
    problem: "",
    architecture: summaries.slice(0, 15).map((s) => ({ module: s.path, purpose: s.summary })),
    glossary: [],
    stack: [],
    milestones: [],
    facts: [],
  };
}

const defaultDeps = (): BriefDeps => ({ store: drizzleBriefStore(), github: installationOctokit, callJson: defaultCallJson });

/**
 * 1. Per repo: tree (with truncated-tree fallback), README, docs, manifests, entry points and recent churn.
 * 2. Rank source files (see rankFiles) and pick ≤40 (≤10 per module first, for breadth); big repos (>2,000 source files or >3 repos) take
 *    ≤6 per module and ≤60 overall.
 * 3. Reuse summaries cached by blob SHA; summarise the rest with Haiku in parallel batches.
 * 4. Big repos only: Haiku turns file summaries into module summaries, a few modules per call.
 * 5. One Sonnet call writes the brief from README, docs, manifests, a folder outline and the summaries.
 * Inputs are shrunk until the build is estimated at ≤120k input tokens; past ~240s a partial brief is saved.
 */
export async function buildBrief(projectId: string, deps: BriefDeps = defaultDeps()) {
  const budgetMs = deps.timeBudgetMs ?? TIME_BUDGET_MS;
  const clock = deadline(budgetMs, deps.now);
  const finalReserve = Math.min(60_000, budgetMs / 4);
  const status: BriefBuildStatus = {
    step: briefProgress[0],
    startedAt: new Date((deps.now ?? Date.now)()).toISOString(),
    stats: { files: 0, cachedSummaries: 0, newSummaries: 0, estTokens: 0 },
  };
  const report = async (step: BriefStep | "Failed", patch: Partial<BriefBuildStatus> = {}) => {
    Object.assign(status, { step }, patch);
    if (step !== "Failed") deps.onProgress?.(step);
    await deps.store.saveStatus?.(projectId, status).catch((err) => console.warn("Saving brief status failed", err));
  };
  let budgetHit = false;
  const notBudget = (err: unknown) => {
    if (!(err instanceof AiBudgetError)) return true;
    budgetHit = true;
    return false;
  };

  try {
    const project = await deps.store.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (project.repos.length === 0) throw new Error(`Project ${projectId} has no repos`);
    const meta = (purpose: "brief" | "brief-files") => ({
      purpose,
      userId: project.userId ?? null,
      projectId,
      projectName: project.name ?? null,
      refType: "project" as const,
      refId: projectId,
      isDemo: project.isDemo,
    });

    await report("Reading README");
    const multi = project.repos.length > 1;
    const label = (m: RepoMaterial, p: string) => (multi ? `${m.repoFullName}/${p}` : p);
    const material = await Promise.all(project.repos.map(async (r) => readRepo(await deps.github(r.installationId), r.repoFullName)));

    const all: KeyFile[] = material.flatMap((m) =>
      m.ranked.map((f) => ({ ...f, repo: m, label: label(m, f.path), module: (multi ? `${m.repoFullName}:` : "") + moduleOf(f.path) })),
    );
    const hierarchical = all.length > BIG_REPO_FILES || project.repos.length > BIG_REPO_COUNT;
    const picked = hierarchical
      ? pickModuleFiles(all, { perModule: PER_MODULE, total: BIG_KEY_FILES, moduleKey: (f) => f.module })
      : pickModuleFiles(all, { perModule: SMALL_PER_MODULE, total: SMALL_KEY_FILES, fill: true, moduleKey: (f) => f.module });

    const summaries = new Map<string, string>();
    await Promise.all(
      material.map(async (m) => {
        const files = picked.filter((f) => f.repo === m && f.sha).map((f) => ({ path: f.path, sha: f.sha! }));
        const cached = (await deps.store.cachedSummaries?.(m.repoFullName, files).catch(() => null)) ?? new Map<string, string>();
        for (const [path, summary] of cached) summaries.set(label(m, path), summary);
      }),
    );
    const cachedCount = summaries.size;
    const fresh = picked.filter((f) => !summaries.has(f.label));
    await Promise.all(
      material.map(async (m) => {
        const mine = fresh.filter((f) => f.repo === m);
        const missing = mine.filter((f) => !m.prefetched.has(f.path)).map((f) => f.path);
        const read = new Map((await m.read(missing, MAX.fileClip)).map((d) => [d.path, d.content]));
        for (const f of mine) f.content = m.prefetched.get(f.path) ?? read.get(f.path);
      }),
    );
    const readable = fresh.filter((f) => f.content !== undefined);

    const groupByModule = (list: Summary[]) => {
      const moduleByLabel = new Map(picked.map((f) => [f.label, f.module]));
      const groups = new Map<string, Summary[]>();
      for (const s of list) {
        const mod = moduleByLabel.get(s.path) ?? ".";
        groups.set(mod, [...(groups.get(mod) ?? []), s]);
      }
      return [...groups].map(([module, files]) => ({ module, files }));
    };

    const finalPrompt = (lvl: Shrink, briefSummaries: Summary[]) => {
      const readmes = material.filter((m) => m.readme).map((m) => (multi ? `## ${m.repoFullName}\n` : "") + clip(m.readme!, lvl.readmeClip));
      const outlineBudget = Math.max(600, Math.floor(lvl.outlineChars / material.length));
      return briefPrompt({
        repos: material.map((m) => m.repoFullName),
        readme: readmes.length ? readmes.join("\n\n") : null,
        docs: material.flatMap((m) => m.docs.slice(0, lvl.docs).map((d) => ({ path: label(m, d.path), content: clip(d.content, lvl.docClip) }))),
        manifests: material.flatMap((m) => m.manifests.map((d) => ({ path: label(m, d.path), content: clip(d.content, lvl.manifestClip) }))),
        tree: material.flatMap((m) => [...(multi ? [`## ${m.repoFullName}`] : []), ...outlineTree(m.outlinePaths, outlineBudget).split("\n")]),
        fileSummaries: briefSummaries,
      });
    };
    const tokens = (p: { system: string; user: string }) => estimateTokens(p.system + p.user);

    const plan = (lvl: Shrink) => {
      const files = readable.slice(0, Math.ceil(readable.length * lvl.fileShare)).map((f) => ({ ...f, content: clip(f.content!, lvl.fileClip) }));
      const batches = chunk(files, BATCH);
      const guessed: Summary[] = [
        ...picked.filter((f) => summaries.has(f.label)).map((f) => ({ path: f.label, summary: summaries.get(f.label)! })),
        ...files.map((f) => ({ path: f.label, summary: PLACEHOLDER_SUMMARY })),
      ];
      let est = batches.reduce((s, b) => s + tokens(briefFileSummariesPrompt(b.map((f) => ({ path: f.label, content: f.content })))), 0);
      if (hierarchical) {
        const groups = groupByModule(guessed);
        est += chunk(groups, MODULES_PER_CALL).reduce((s, g) => s + tokens(moduleSummariesPrompt(g)), 0);
        est += tokens(finalPrompt(lvl, groups.map((g) => ({ path: g.module, summary: PLACEHOLDER_SUMMARY.repeat(2) }))));
      } else est += tokens(finalPrompt(lvl, guessed));
      return { lvl, batches, est };
    };
    let chosen = plan(shrinkLevels[0]);
    for (const lvl of shrinkLevels.slice(1)) {
      if (chosen.est <= MAX_INPUT_TOKENS) break;
      chosen = plan(lvl);
    }
    if (chosen.est > MAX_INPUT_TOKENS) console.warn(`Brief for ${projectId} is still estimated at ${chosen.est} input tokens after shrinking`);

    await report("Mapping modules", { stats: { files: picked.length, cachedSummaries: cachedCount, newSummaries: 0, estTokens: chosen.est } });
    let partial = false;
    let stopped = false;
    const summaryPhase = mapLimit(chosen.batches, CONCURRENCY, async (batch, i) => {
      if (stopped || budgetHit) return;
      try {
        const prompt = briefFileSummariesPrompt(batch.map((f) => ({ path: f.label, content: f.content })));
        const { data } = await deps.callJson(FileSummarySchema, { ...prompt, maxTokens: 2000, effort: "low", model: SUMMARY_MODEL, meta: meta("brief-files") });
        if (stopped) return;
        const byLabel = new Map(batch.map((f) => [f.label, f]));
        const rows: SummaryRow[] = [];
        for (const s of data.summaries) {
          const f = byLabel.get(s.path);
          if (!f) continue;
          summaries.set(f.label, s.summary);
          status.stats.newSummaries++;
          if (f.sha) rows.push({ repoFullName: f.repo.repoFullName, path: f.path, blobSha: f.sha, summary: s.summary, model: SUMMARY_MODEL });
        }
        await deps.store.saveSummaries?.(rows).catch((err) => console.warn("Caching file summaries failed", err));
      } catch (err) {
        if (notBudget(err)) console.warn(`File summaries failed for batch ${i + 1}`, err);
      }
    });
    if (!(await within(summaryPhase.then(() => true), Math.max(0, clock.remaining() - finalReserve), false))) {
      stopped = true;
      partial = true;
    }

    const fileSummaryList: Summary[] = picked.filter((f) => summaries.has(f.label)).map((f) => ({ path: f.label, summary: summaries.get(f.label)! }));
    let briefSummaries = fileSummaryList;
    if (budgetHit) partial = true;
    if (hierarchical && !partial && fileSummaryList.length) {
      const groups = groupByModule(fileSummaryList);
      const moduleSummaries = new Map<string, string>();
      const modulePhase = mapLimit(chunk(groups, MODULES_PER_CALL), CONCURRENCY, async (g) => {
        if (budgetHit) return;
        try {
          const { data } = await deps.callJson(ModuleSummarySchema, { ...moduleSummariesPrompt(g), maxTokens: 1500, effort: "low", model: SUMMARY_MODEL, meta: meta("brief-files") });
          for (const m of data.modules) moduleSummaries.set(m.module, m.summary);
        } catch (err) {
          if (notBudget(err)) console.warn("Module summaries failed", err);
        }
      });
      if (!(await within(modulePhase.then(() => true), Math.max(0, clock.remaining() - finalReserve), false)) || budgetHit) partial = true;
      briefSummaries = groups.flatMap((g) => (moduleSummaries.has(g.module) ? [{ path: g.module, summary: moduleSummaries.get(g.module)! }] : g.files));
    }

    await report("Building glossary");
    const finalCall = budgetHit
      ? Promise.resolve(null)
      : deps
          .callJson(BriefSchema, { ...finalPrompt(chosen.lvl, briefSummaries), maxTokens: 4000, meta: meta("brief") })
          .then((r) => r.data, (err) => {
            if (notBudget(err)) throw err;
            return null;
          });
    let brief = await within(finalCall, clock.remaining(), null);
    if (!brief) {
      finalCall.catch(() => {});
      partial = true;
      brief = fallbackBrief(material, briefSummaries);
    }

    // Existing facts can come from the author's answers, so they survive a rebuild.
    const existing = Array.isArray(project.brief?.facts) ? (project.brief.facts as string[]) : [];
    const facts = [...new Set([...existing, ...brief.facts])];
    const stored: Record<string, unknown> = { ...brief, facts, ...(partial ? { partial: true } : {}) };
    await deps.store.saveBrief(projectId, stored);
    await report("Done", { finishedAt: new Date().toISOString(), ...(partial ? { partial: true } : {}), ...(budgetHit ? { error: "budget" } : {}) });
    return stored;
  } catch (err) {
    await report("Failed", { finishedAt: new Date().toISOString(), error: (err as Error).message });
    throw err;
  }
}
