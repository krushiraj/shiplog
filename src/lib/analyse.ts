import { and, eq, inArray, like, or, sql } from "drizzle-orm";
import { db as defaultDb, type Db } from "@/db";
import { changeCards, events, projectRepos, projects, users } from "@/db/schema";
import { callJson as defaultCallJson } from "./ai/claude";
import { analysePrompt, type EventContext, type FileContext } from "./ai/prompts";
import { ChangeCardSchema, type Brief } from "./ai/schemas";
import { resolveConfig, type PartialConfig } from "./config";
import { budgetHunks, shouldSkipFile } from "./diffs";
import { installationOctokit, type GitHub } from "./github/app";
import { scrub } from "./scrub";

export type StoredEvent = {
  id: string;
  repoFullName: string;
  kind: string;
  ref: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- trimmed webhook JSON, shape depends on kind
  payload: Record<string, any>;
  occurredAt: Date;
  processedAt: Date | null;
};

export type RepoProject = {
  installationId: number;
  userDefaults: PartialConfig;
  projectConfig: PartialConfig;
  overrides: PartialConfig;
  brief: Record<string, unknown> | null;
  projectId?: string;
  projectName?: string;
  userId?: string;
  isDemo?: boolean;
};

export type CardRow = typeof changeCards.$inferInsert & { significance: number; what: string };

export type AnalyseStore = {
  getEvent(id: string): Promise<StoredEvent | null>;
  projectsForRepo(repoFullName: string): Promise<RepoProject[]>;
  findPrForCommit(repoFullName: string, sha: string, prNumber: number | null): Promise<{ hasCard: boolean } | null>;
  insertCard(card: CardRow): Promise<void>;
  cancelCommitCard(repoFullName: string, sha: string): Promise<boolean>;
  markProcessed(eventId: string): Promise<void>;
};

export type AnalyseDeps = {
  store: AnalyseStore;
  github: (installationId: number) => Promise<GitHub>;
  callJson: typeof defaultCallJson;
};

export function drizzleAnalyseStore(database: Db = defaultDb): AnalyseStore {
  return {
    async getEvent(id) {
      const [row] = await database.select().from(events).where(eq(events.id, id)).limit(1);
      return (row as StoredEvent | undefined) ?? null;
    },
    async projectsForRepo(repoFullName) {
      const rows = await database
        .select({
          installationId: projectRepos.installationId,
          overrides: projectRepos.overrides,
          projectConfig: projects.config,
          brief: projects.brief,
          userDefaults: users.defaults,
          projectId: projects.id,
          projectName: projects.name,
          userId: projects.userId,
          isDemo: projects.isDemo,
        })
        .from(projectRepos)
        .innerJoin(projects, eq(projects.id, projectRepos.projectId))
        .innerJoin(users, eq(users.id, projects.userId))
        .where(eq(projectRepos.repoFullName, repoFullName));
      return rows as RepoProject[];
    },
    async findPrForCommit(repoFullName, sha, prNumber) {
      const match = prNumber == null
        ? sql`${events.payload}->>'mergeSha' = ${sha}`
        : or(sql`${events.payload}->>'mergeSha' = ${sha}`, eq(events.ref, String(prNumber)));
      const [row] = await database
        .select({ cardId: changeCards.id })
        .from(events)
        .leftJoin(changeCards, eq(changeCards.eventId, events.id))
        .where(and(eq(events.repoFullName, repoFullName), eq(events.kind, "pr_merged"), match))
        .limit(1);
      return row ? { hasCard: row.cardId !== null } : null;
    },
    async insertCard(card) {
      await database.insert(changeCards).values(card).onConflictDoNothing({ target: changeCards.eventId });
    },
    async cancelCommitCard(repoFullName, sha) {
      const target = database
        .select({ id: events.id })
        .from(events)
        .where(and(eq(events.repoFullName, repoFullName), eq(events.kind, "commit"), like(events.ref, `${sha}%`)));
      const rows = await database
        .update(changeCards)
        .set({ cancelled: true })
        .where(inArray(changeCards.eventId, target))
        .returning({ id: changeCards.id });
      return rows.length > 0;
    },
    async markProcessed(eventId) {
      await database.update(events).set({ processedAt: new Date() }).where(eq(events.id, eventId));
    },
  };
}

const defaultDeps = (): AnalyseDeps => ({
  store: drizzleAnalyseStore(),
  github: installationOctokit,
  callJson: defaultCallJson,
});

const firstLine = (s: unknown) => (typeof s === "string" ? s.split("\n")[0].trim() : "");
const clean = (s: unknown): string | null => (typeof s === "string" && s.trim() ? scrub(s) : null);
const CHORE = /^(chore|deps|docs|build\(deps\)|bump)\b/i;

export function fallbackCard(e: StoredEvent): { what: string; significance: number } {
  const p = e.payload;
  const title: string =
    e.kind === "commit" || e.kind === "revert" ? firstLine(p.message)
    : e.kind === "pr_merged" ? firstLine(p.title)
    : e.kind === "release" ? firstLine(p.name) || `Released ${e.ref}`
    : e.kind === "issue_closed" ? `Closed: ${firstLine(p.title)}`
    : `Tagged ${e.ref}`;
  const base = { release: 3, tag: 3, pr_merged: 2 }[e.kind] ?? 1;
  const subject = firstLine(p.message ?? p.title);
  return { what: scrub(title || `${e.kind} ${e.ref}`).slice(0, 280), significance: CHORE.test(subject) ? 0 : base };
}

type RawFile = { path: string; status?: string; patch?: string; additions?: number; deletions?: number };
type Context = { event: EventContext; files: RawFile[] };

const LINKED_ISSUE = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

const toFiles = (files: { filename: string; status?: string; patch?: string; additions?: number; deletions?: number }[] = []) =>
  files.map((f) => ({ path: f.filename, status: f.status, patch: f.patch, additions: f.additions, deletions: f.deletions }));

async function fetchContext(e: StoredEvent, gh: GitHub | null): Promise<Context> {
  const p = e.payload;
  const meta: Context = {
    event: { kind: e.kind, title: p.title ?? p.name ?? null, body: p.body ?? null, message: p.message ?? null, labels: p.labels ?? [] },
    files: [...(p.added ?? []), ...(p.modified ?? []), ...(p.removed ?? [])].map((path: string) => ({ path })),
  };
  if (!gh) return meta;
  const [owner, repo] = e.repoFullName.split("/");

  try {
    switch (e.kind) {
      case "commit":
      case "revert": {
        const { data } = await gh.rest.repos.getCommit({ owner, repo, ref: e.ref });
        return { event: { ...meta.event, message: p.message ?? data.commit.message }, files: toFiles(data.files) };
      }
      case "pr_merged": {
        const pull_number = Number(e.ref);
        const [{ data: pr }, { data: files }] = await Promise.all([
          gh.rest.pulls.get({ owner, repo, pull_number }),
          gh.rest.pulls.listFiles({ owner, repo, pull_number, per_page: 100 }),
        ]);
        const numbers = [...new Set([...(pr.body ?? "").matchAll(LINKED_ISSUE)].map((m) => Number(m[1])))].slice(0, 3);
        const issues = await Promise.all(
          numbers.map((issue_number) =>
            gh.rest.issues.get({ owner, repo, issue_number }).then(({ data }) => ({ title: data.title, body: data.body ?? null }), () => null),
          ),
        );
        return {
          event: { kind: e.kind, title: pr.title, body: pr.body, labels: pr.labels.map((l) => l.name), issues: issues.filter((i) => i !== null) },
          files: toFiles(files),
        };
      }
      case "tag": {
        const { data: tags } = await gh.rest.repos.listTags({ owner, repo, per_page: 20 });
        const prev = tags[tags.findIndex((t) => t.name === e.ref) + 1];
        if (!prev || !tags.some((t) => t.name === e.ref)) return meta;
        const { data } = await gh.rest.repos.compareCommitsWithBasehead({ owner, repo, basehead: `${prev.name}...${e.ref}` });
        const message = data.commits.slice(-20).map((c) => `- ${firstLine(c.commit.message)}`).join("\n");
        return { event: { ...meta.event, title: `Tag ${e.ref} (since ${prev.name})`, message }, files: toFiles(data.files) };
      }
      default:
        return meta;
    }
  } catch (err) {
    console.warn(`Context fetch failed for ${e.kind} ${e.repoFullName}@${e.ref}; using metadata`, err);
    return meta;
  }
}

function scrubEvent(ev: EventContext): EventContext {
  return {
    ...ev,
    title: clean(ev.title),
    body: clean(ev.body),
    message: clean(ev.message),
    issues: ev.issues?.map((i) => ({ title: scrub(i.title), body: clean(i.body) })),
  };
}

function readsDiffs(projectsForRepo: RepoProject[]): boolean {
  return projectsForRepo.every((p) => {
    try {
      return resolveConfig(p.userDefaults ?? {}, p.projectConfig ?? {}, p.overrides ?? {}).ai.read_diffs;
    } catch {
      return false; // an unreadable config never leaks diffs
    }
  });
}

function prNumberOf(e: StoredEvent): number | null {
  if (typeof e.payload.prNumber === "number") return e.payload.prNumber;
  const m = firstLine(e.payload.message).match(/\(#(\d+)\)$/);
  return m ? Number(m[1]) : null;
}

export async function analyseEvent(eventId: string, deps: AnalyseDeps = defaultDeps()): Promise<void> {
  const { store } = deps;
  const e = await store.getEvent(eventId);
  if (!e || e.processedAt) return;
  const done = () => store.markProcessed(e.id);

  if (e.kind === "revert" && typeof e.payload.revertsSha === "string") {
    if (await store.cancelCommitCard(e.repoFullName, e.payload.revertsSha)) return done();
  }

  let demote = false;
  if (e.kind === "commit") {
    const prNumber = prNumberOf(e);
    const pr = await store.findPrForCommit(e.repoFullName, e.ref, prNumber);
    if (pr?.hasCard) return done();
    demote = pr !== null || prNumber !== null;
  }

  const repoProjects = await store.projectsForRepo(e.repoFullName);
  if (repoProjects.length === 0) return done();

  const readDiffs = readsDiffs(repoProjects);
  const installationId = (e.payload.installationId as number | undefined) ?? repoProjects[0].installationId;
  const gh = installationId ? await deps.github(installationId).catch(() => null) : null;
  const ctx = await fetchContext(e, gh);
  const kept = ctx.files.filter((f) => !shouldSkipFile(f.path));
  const status = new Map(kept.map((f) => [f.path, f.status]));
  const files: FileContext[] = readDiffs
    ? budgetHunks(kept.map((f) => ({ file: f.path, patch: f.patch, additions: f.additions, deletions: f.deletions }))).map(
        (f) => ({ path: f.file, status: status.get(f.file), patch: f.patch || null }),
      )
    : kept.slice(0, 50).map((f) => ({ path: f.path, status: f.status }));
  const brief = (repoProjects.find((p) => p.brief)?.brief ?? null) as Brief | null;

  const base = { eventId: e.id, repoFullName: e.repoFullName, occurredAt: e.occurredAt };
  let card: CardRow;
  try {
    const prompt = analysePrompt({ brief, event: scrubEvent(ctx.event), files, readDiffs });
    // A repo can feed several projects; the first one's owner pays for the shared card.
    const owner = repoProjects[0];
    const meta = {
      purpose: "analyse" as const,
      refType: "event" as const,
      refId: e.id,
      userId: owner.userId,
      projectId: owner.projectId,
      projectName: owner.projectName,
      isDemo: owner.isDemo,
    };
    const { data } = await deps.callJson(ChangeCardSchema, { ...prompt, maxTokens: 1024, cacheSystem: true, meta });
    card = {
      ...base,
      what: data.what,
      why: data.why,
      whyInferred: data.why_inferred,
      how: data.how,
      impact: data.impact,
      significance: data.significance,
      openQuestion: data.open_question,
    };
  } catch (err) {
    console.warn(`AI analysis failed for event ${e.id}; using a metadata card`, err);
    card = { ...base, ...fallbackCard(e), why: null, whyInferred: true, how: null, impact: null, openQuestion: null };
  }
  if (demote) card = { ...card, significance: 0, openQuestion: null };

  await store.insertCard(card);
  await done();
}

const MAX_PER_RUN = 20;

export async function analyseEvents(
  ids: string[],
  deps?: AnalyseDeps,
  run: (id: string) => Promise<void> = (id) => analyseEvent(id, deps ?? (deps = defaultDeps())),
): Promise<void> {
  for (const id of ids.slice(0, MAX_PER_RUN)) {
    try {
      await run(id);
    } catch (err) {
      console.error(`Analysis of event ${id} failed`, err);
    }
  }
}
