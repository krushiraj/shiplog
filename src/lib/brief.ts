import { eq } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db";
import { projectRepos, projects } from "@/db/schema";
import { callJson as defaultCallJson } from "./ai/claude";
import { briefFileSummariesPrompt, briefPrompt } from "./ai/prompts";
import { BriefSchema, FileSummarySchema } from "./ai/schemas";
import { shouldSkipFile } from "./diffs";
import { installationOctokit, type GitHub } from "./github/app";
import { scrub } from "./scrub";

export const briefProgress = ["Reading README", "Mapping modules", "Building glossary", "Done"] as const;
export type BriefStep = (typeof briefProgress)[number];

export type BriefStore = {
  getProject(projectId: string): Promise<{ brief: Record<string, unknown> | null; repos: { repoFullName: string; installationId: number }[] } | null>;
  saveBrief(projectId: string, brief: Record<string, unknown>): Promise<void>;
};

export type BriefDeps = {
  store: BriefStore;
  github: (installationId: number) => Promise<GitHub>;
  callJson: typeof defaultCallJson;
  onProgress?: (step: BriefStep) => void;
};

export function drizzleBriefStore(database: Db = defaultDb): BriefStore {
  return {
    async getProject(projectId) {
      const [project] = await database.select({ brief: projects.brief }).from(projects).where(eq(projects.id, projectId)).limit(1);
      if (!project) return null;
      const repos = await database
        .select({ repoFullName: projectRepos.repoFullName, installationId: projectRepos.installationId })
        .from(projectRepos)
        .where(eq(projectRepos.projectId, projectId));
      return { brief: project.brief, repos };
    },
    async saveBrief(projectId, brief) {
      await database.update(projects).set({ brief }).where(eq(projects.id, projectId));
    },
  };
}

const MAX_KEY_FILES = 40;
const MAX_ENTRY_POINTS = 10;
const MAX_DOCS = 10;
const BATCH = 10;
const MANIFESTS = ["package.json", "pyproject.toml", "go.mod", "Cargo.toml"];

const SOURCE = /\.(tsx?|jsx?|mjs|cjs|py|go|rs|rb|java|kt|swift|c|cc|cpp|h|cs|php|exs?|vue|svelte|scala)$/;
const TEST = /(^|\/)(__tests__|__mocks__|tests?|spec|e2e|fixtures)\/|\.(test|spec)\.[^/]+$|_test\.(go|py)$|(^|\/)test_[^/]+\.py$/;
const ENTRY = /(^|\/)(index|main|app|server|cli|mod|lib)\.(tsx?|jsx?|mjs|py|go|rs)$|(^|\/)app\/(page|layout)\.(tsx|jsx)$/;

export type TreeFile = { path: string; size?: number };

const depth = (p: string) => p.split("/").length;

export function pickKeyFiles(tree: TreeFile[], max = MAX_KEY_FILES): string[] {
  const candidates = tree.filter((f) => SOURCE.test(f.path) && !f.path.endsWith(".d.ts") && !TEST.test(f.path) && !shouldSkipFile(f.path));
  const entries = candidates
    .filter((f) => ENTRY.test(f.path))
    .sort((a, b) => depth(a.path) - depth(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_ENTRY_POINTS);
  const chosen = new Set(entries.map((f) => f.path));
  const rest = candidates.filter((f) => !chosen.has(f.path)).sort((a, b) => (b.size ?? 0) - (a.size ?? 0));
  return [...chosen, ...rest.map((f) => f.path)].slice(0, max);
}

const decode = (content: string) => Buffer.from(content, "base64").toString("utf8");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}\n… (truncated)` : s);

async function readFile(gh: GitHub, owner: string, repo: string, path: string, ref: string, limit: number): Promise<string | null> {
  try {
    const { data } = await gh.rest.repos.getContent({ owner, repo, path, ref });
    if (Array.isArray(data) || data.type !== "file" || !("content" in data)) return null;
    return scrub(clip(decode(data.content), limit));
  } catch {
    return null;
  }
}

type RepoMaterial = {
  repoFullName: string;
  readme: string | null;
  docs: { path: string; content: string }[];
  manifests: { path: string; content: string }[];
  tree: string[];
  keyFiles: { path: string; content: string }[];
};

async function readRepo(gh: GitHub, repoFullName: string, keyFileBudget: number, label: (p: string) => string): Promise<RepoMaterial> {
  const [owner, repo] = repoFullName.split("/");
  const { data: info } = await gh.rest.repos.get({ owner, repo });
  const ref = info.default_branch;
  const { data: treeData } = await gh.rest.git.getTree({ owner, repo, tree_sha: ref, recursive: "true" });
  const blobs: TreeFile[] = treeData.tree.filter((t) => t.type === "blob" && t.path).map((t) => ({ path: t.path!, size: t.size }));

  const readme = await gh.rest.repos
    .getReadme({ owner, repo, ref })
    .then(({ data }) => scrub(clip(decode(data.content), 8000)), () => null);

  const read = async (paths: string[], limit: number) =>
    (await Promise.all(paths.map(async (path) => ({ path: label(path), content: await readFile(gh, owner, repo, path, ref, limit) }))))
      .filter((f): f is { path: string; content: string } => f.content !== null);

  const docPaths = blobs.map((b) => b.path).filter((p) => /^docs\/.+\.md$/i.test(p)).sort().slice(0, MAX_DOCS);
  const manifestPaths = blobs.map((b) => b.path).filter((p) => MANIFESTS.includes(p));
  const [docs, manifests, keyFiles] = await Promise.all([
    read(docPaths, 4000),
    read(manifestPaths, 3000),
    read(pickKeyFiles(blobs, keyFileBudget), 3000),
  ]);

  const tree = blobs.map((b) => b.path).filter((p) => !shouldSkipFile(p)).slice(0, 400).map(label);
  return { repoFullName, readme, docs, manifests, tree, keyFiles };
}

const defaultDeps = (): BriefDeps => ({ store: drizzleBriefStore(), github: installationOctokit, callJson: defaultCallJson });

export async function buildBrief(projectId: string, deps: BriefDeps = defaultDeps()) {
  const progress = deps.onProgress ?? (() => {});
  const project = await deps.store.getProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  if (project.repos.length === 0) throw new Error(`Project ${projectId} has no repos`);

  progress("Reading README");
  const multi = project.repos.length > 1;
  const perRepo = Math.max(1, Math.floor(MAX_KEY_FILES / project.repos.length));
  const material = await Promise.all(
    project.repos.map(async (r) =>
      readRepo(await deps.github(r.installationId), r.repoFullName, perRepo, (p) => (multi ? `${r.repoFullName}/${p}` : p)),
    ),
  );

  progress("Mapping modules");
  const keyFiles = material.flatMap((m) => m.keyFiles).slice(0, MAX_KEY_FILES);
  const fileSummaries: { path: string; summary: string }[] = [];
  for (let i = 0; i < keyFiles.length; i += BATCH) {
    const prompt = briefFileSummariesPrompt(keyFiles.slice(i, i + BATCH));
    try {
      const { data } = await deps.callJson(FileSummarySchema, { ...prompt, maxTokens: 2000, effort: "low" });
      fileSummaries.push(...data.summaries);
    } catch (err) {
      console.warn(`File summaries failed for batch ${i / BATCH + 1}`, err);
    }
  }

  progress("Building glossary");
  const readmes = material.filter((m) => m.readme).map((m) => (multi ? `## ${m.repoFullName}\n${m.readme}` : m.readme!));
  const prompt = briefPrompt({
    repos: material.map((m) => m.repoFullName),
    readme: readmes.length ? readmes.join("\n\n") : null,
    docs: material.flatMap((m) => m.docs),
    manifests: material.flatMap((m) => m.manifests),
    tree: material.flatMap((m) => m.tree),
    fileSummaries,
  });
  const { data: brief } = await deps.callJson(BriefSchema, { ...prompt, maxTokens: 4000 });

  // Existing facts can come from the author's answers, so they survive a rebuild.
  const existing = Array.isArray(project.brief?.facts) ? (project.brief.facts as string[]) : [];
  const facts = [...new Set([...existing, ...brief.facts])];
  const stored = { ...brief, facts };
  await deps.store.saveBrief(projectId, stored);
  progress("Done");
  return stored;
}
