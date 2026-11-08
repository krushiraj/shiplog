import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";
import { db as defaultDb, type Db } from "@/db";
import { githubInstallations, projectRepos, projects, users, type CachedChannel } from "@/db/schema";
import { callJson } from "./ai/claude";
import { buildBrief, drizzleBriefStore, type BriefStep } from "./brief";
import { persistedStep, type BriefBuildStatus } from "./brief/status";
import { ProjectConfigSchema, resolveConfig, type PartialConfig, type ProjectConfig } from "./config";
import { installationOctokit } from "./github/app";
import { listInstallationRepos, type InstallationRepo } from "./github/repos";

const digest = ProjectConfigSchema.shape.triggers.shape.digest.shape;

export const CreateProjectInputSchema = z.object({
  name: z.string().trim().min(1, "name is required").max(80),
  repos: z
    .array(z.object({ fullName: z.string().regex(/^[\w.-]+\/[\w.-]+$/, "repo as owner/name"), installationId: z.number().int().positive() }))
    .min(1, "pick at least one repo")
    .max(20),
  channels: z.array(z.string().min(1)).max(20).default([]),
  timezone: ProjectConfigSchema.shape.timezone,
  digestEvery: digest.every,
  digestAt: digest.at,
  reviewMode: ProjectConfigSchema.shape.review.shape.mode,
});
export type CreateProjectInput = z.infer<typeof CreateProjectInputSchema>;
type Settings = Omit<CreateProjectInput, "name" | "repos">;

export class ProjectInputError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
    this.name = "ProjectInputError";
  }
}

export type ProjectStore = {
  getUser(userId: string): Promise<{ defaults: Record<string, unknown>; channels: CachedChannel[] | null } | null>;
  installationIds(userId: string): Promise<number[]>;
  insertProject(
    project: { userId: string; name: string; config: PartialConfig },
    repos: { repoFullName: string; installationId: number }[],
  ): Promise<string>;
};

export type ProjectDeps = {
  store: ProjectStore;
  listRepos: (installationId: number) => Promise<InstallationRepo[]>;
};

// Only installations proven through GitHub user OAuth are trusted.
const verifiedInstallationsOf = (userId: string) =>
  and(eq(githubInstallations.userId, userId), eq(githubInstallations.suspended, false), isNotNull(githubInstallations.verifiedAt));

export function drizzleProjectStore(database: Db = defaultDb): ProjectStore {
  return {
    async getUser(userId) {
      const [user] = await database.select({ defaults: users.defaults, channels: users.channels }).from(users).where(eq(users.id, userId)).limit(1);
      return user ?? null;
    },
    async installationIds(userId) {
      const rows = await database
        .select({ id: githubInstallations.installationId })
        .from(githubInstallations)
        .where(verifiedInstallationsOf(userId));
      return rows.map((r) => r.id);
    },
    async insertProject(project, repos) {
      const id = crypto.randomUUID();
      await database.batch([
        database.insert(projects).values({ id, userId: project.userId, name: project.name, config: project.config as Record<string, unknown> }),
        database.insert(projectRepos).values(repos.map((r) => ({ projectId: id, ...r }))),
      ]);
      return id;
    },
  };
}

const defaultDeps = (): ProjectDeps => ({ store: drizzleProjectStore(), listRepos: (id) => listInstallationRepos(id) });

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** Only the fields that differ from what the project would inherit anyway. */
export function configDiff(s: Settings, baseline: ProjectConfig): PartialConfig {
  const out: PartialConfig = {};
  if (!same(s.channels, baseline.channels)) out.channels = s.channels;
  if (s.timezone !== baseline.timezone) out.timezone = s.timezone;
  const d = baseline.triggers.digest;
  if (s.digestEvery !== d.every || s.digestAt !== d.at) {
    out.triggers = { digest: { ...(s.digestEvery !== d.every && { every: s.digestEvery }), ...(s.digestAt !== d.at && { at: s.digestAt }) } };
  }
  if (s.reviewMode !== baseline.review.mode) out.review = { mode: s.reviewMode };
  return out;
}

export async function createProject(userId: string, raw: unknown, deps: ProjectDeps = defaultDeps()): Promise<{ id: string }> {
  const parsed = CreateProjectInputSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ProjectInputError(parsed.error.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; "));
  }
  const input = parsed.data;

  const user = await deps.store.getUser(userId);
  if (!user) throw new ProjectInputError("Unknown user", 401);

  const owned = new Set(await deps.store.installationIds(userId));
  const byInstallation = new Map<number, string[]>();
  for (const r of input.repos) {
    if (!owned.has(r.installationId)) throw new ProjectInputError(`Installation ${r.installationId} is not yours`, 403);
    byInstallation.set(r.installationId, [...(byInstallation.get(r.installationId) ?? []), r.fullName]);
  }
  for (const [installationId, names] of byInstallation) {
    const accessible = new Set((await deps.listRepos(installationId)).map((r) => r.fullName));
    const missing = names.find((n) => !accessible.has(n));
    if (missing) throw new ProjectInputError(`${missing} is not accessible to the Shiplog GitHub App`, 403);
  }

  const usable = new Set((user.channels ?? []).filter((c) => !c.isDisconnected).map((c) => c.id));
  const badChannel = input.channels.find((c) => !usable.has(c));
  if (badChannel) throw new ProjectInputError(`Channel ${badChannel} is unknown or disconnected`);

  const baseline = resolveConfig(user.defaults as PartialConfig, {});
  const config = configDiff(input, baseline);
  const repos = [...new Map(input.repos.map((r) => [r.fullName, { repoFullName: r.fullName, installationId: r.installationId }])).values()];
  const id = await deps.store.insertProject({ userId, name: input.name, config }, repos);
  return { id };
}

export type RepoGroup = { installationId: number; accountLogin: string; repos: InstallationRepo[]; error: string | null };

/** Repos the user can pick from, grouped by their GitHub App installations. */
export async function listUserRepos(userId: string, database: Db = defaultDb): Promise<RepoGroup[]> {
  const installs = await database
    .select({ installationId: githubInstallations.installationId, accountLogin: githubInstallations.accountLogin })
    .from(githubInstallations)
    .where(verifiedInstallationsOf(userId));
  return Promise.all(
    installs.map(async (i) => {
      try {
        return { ...i, repos: await listInstallationRepos(i.installationId), error: null };
      } catch (e) {
        console.error(`Listing repos for installation ${i.installationId} failed`, e);
        return { ...i, repos: [], error: "Could not list repos for this installation" };
      }
    }),
  );
}

export async function getOwnedProject(userId: string, projectId: string, database: Db = defaultDb) {
  if (!z.uuid().safeParse(projectId).success) return null;
  const [project] = await database
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);
  return project ?? null;
}

// In-memory progress is only visible on the instance running the build; other instances read `projects.brief_status`.
export type BriefStatus = BriefStep | "Failed";
const briefStatus = new Map<string, BriefStatus>();

export const getBriefStatus = (projectId: string, persisted?: Partial<BriefBuildStatus> | null): BriefStatus | null =>
  briefStatus.get(projectId) ?? (persistedStep(persisted) as BriefStatus | null);

export async function runBrief(projectId: string): Promise<void> {
  briefStatus.set(projectId, "Reading README");
  try {
    await buildBrief(projectId, { store: drizzleBriefStore(), github: installationOctokit, callJson, onProgress: (step) => briefStatus.set(projectId, step) });
  } catch (e) {
    console.error(`Brief build failed for project ${projectId}`, e);
    briefStatus.set(projectId, "Failed");
  }
}
