import { randomUUID } from "node:crypto";
import { eq, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  changeCards,
  demoSessions,
  drafts,
  events,
  posts,
  projectRepos,
  projects,
  users,
  voiceProfiles,
  voiceRules,
  type CachedChannel,
} from "@/db/schema";
import fixture from "../../fixtures/demo.json";

export const DEMO_AI_LIMIT = 15;
const ACCOUNT_PREFIX = "demo:";
const HOUR = 3_600_000;

export class DemoLimitError extends Error {
  constructor() {
    super(`The demo allows ${DEMO_AI_LIMIT} AI calls. Connect Buffer to keep going.`);
    this.name = "DemoLimitError";
  }
}

/**
 * Demo rows use their own repo name so real webhooks, the analyser and real projects
 * watching krushiraj/shiplog never see them. The "#" suffix keeps github.com links working.
 */
export const demoRepoName = (sessionId: string) => `${fixture.project.repo}#demo-${sessionId.slice(0, 8)}`;
export const displayRepo = (repoFullName: string) => repoFullName.replace(/#demo-[0-9a-f]+$/, "");

const channel = (id: string, service: string, name: string): CachedChannel => ({
  id, name, displayName: name, service, avatar: "", isDisconnected: false, isLocked: false,
  isQueuePaused: false, timezone: "Asia/Kolkata", type: null, descriptor: null,
});
export const DEMO_CHANNELS: CachedChannel[] = [
  channel("linkedin", "linkedin", "Demo LinkedIn"),
  channel("x", "twitter", "Demo X"),
];

export type DemoSeed = {
  session: typeof demoSessions.$inferInsert & { id: string; createdAt: Date };
  user: typeof users.$inferInsert & { id: string };
  project: typeof projects.$inferInsert & { id: string };
  repo: typeof projectRepos.$inferInsert;
  events: (typeof events.$inferInsert & { id: string })[];
  cards: (typeof changeCards.$inferInsert & { id: string; occurredAt: Date })[];
  profiles: (typeof voiceProfiles.$inferInsert)[];
  rules: (typeof voiceRules.$inferInsert)[];
  drafts: (typeof drafts.$inferInsert & { cardIds: string[]; variants: Record<string, string> })[];
};

type FixtureCard = (typeof fixture.cards)[number] & { kind?: string; ref?: string; sha?: string; whyInferred?: boolean; openQuestion?: string };

export function buildDemoSeed(sessionId: string, now: Date, newId: () => string = randomUUID): DemoSeed {
  const ago = (hours: number) => new Date(now.getTime() - hours * HOUR);
  const repoFullName = demoRepoName(sessionId);
  const repoUrl = `https://github.com/${fixture.project.repo}`;
  const userId = newId();
  const projectId = newId();

  const evs: DemoSeed["events"] = [];
  const cards: DemoSeed["cards"] = [];
  const cardIdByRef = new Map<string, string>();
  for (const c of fixture.cards as FixtureCard[]) {
    const kind = c.kind ?? "commit";
    const ref = c.sha ?? c.ref!;
    const occurredAt = ago(c.hoursAgo);
    const eventId = newId();
    const cardId = newId();
    cardIdByRef.set(ref, cardId);
    const url = kind === "commit" ? `${repoUrl}/commit/${ref}` : `${repoUrl}/releases/tag/${ref}`;
    const payload = kind === "commit" ? { message: c.message, url, author: "krushiraj" } : { name: c.message, url, prerelease: false };
    evs.push({ id: eventId, deliveryId: `demo-${sessionId}`, repoFullName, kind, ref, payload, occurredAt, processedAt: occurredAt });
    cards.push({
      id: cardId,
      eventId,
      repoFullName,
      what: c.what,
      why: c.why,
      whyInferred: c.whyInferred ?? false,
      how: c.how,
      impact: c.impact,
      significance: c.significance,
      openQuestion: c.openQuestion ?? null,
      occurredAt,
    });
  }

  const targets = DEMO_CHANNELS.map((ch) => ({ channelId: ch.id, key: ch.id }));
  const zeroUsage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

  return {
    session: { id: sessionId, createdAt: now, aiCalls: 0 },
    user: {
      id: userId,
      bufferAccountId: `${ACCOUNT_PREFIX}${sessionId}`,
      timezone: "Asia/Kolkata",
      channels: DEMO_CHANNELS,
      createdAt: now,
    },
    project: { id: projectId, userId, name: fixture.project.name, config: fixture.project.config, brief: fixture.project.brief, isDemo: true, lastDigestAt: ago(1) },
    repo: { projectId, repoFullName, installationId: 0 },
    events: evs,
    cards,
    profiles: Object.entries(fixture.voice).map(([register, dna]) => ({ userId, projectId: null, register, dna })),
    rules: fixture.rules.map((r) => ({ ...r, userId, projectId: null, lastSeenAt: ago(2) })),
    drafts: fixture.drafts.map((d) => ({
      id: newId(),
      projectId,
      trigger: d.trigger,
      cardIds: d.cards.map((ref) => cardIdByRef.get(ref)!),
      variants: d.variants,
      status: "pending",
      createdAt: ago(d.hoursAgo),
      gate: {
        label: d.label,
        channels: Object.fromEntries(targets.map((t) => [t.key, { fixed: [], violations: [], blocked: false }])),
        targets,
        voiceScore: d.voiceScore,
        suggestions: d.suggestions,
        themes: d.themes,
        fallback: false,
        usage: zeroUsage,
      },
    })),
  };
}

export interface DemoStore {
  insertSeed(seed: DemoSeed): Promise<void>;
  sessionIdForUser(userId: string): Promise<string | null>;
  /** Atomically increments and returns the session's AI call count. */
  incrementAiCalls(sessionId: string): Promise<number>;
  expiredSessions(before: Date): Promise<string[]>;
  /** Deletes the sessions and every row created for them. */
  deleteSessions(ids: string[]): Promise<void>;
}

export type DemoDeps = { store?: DemoStore; now?: () => Date; newId?: () => string };

export async function createDemoUser(deps: DemoDeps = {}): Promise<{ userId: string; projectId: string }> {
  const store = deps.store ?? drizzleDemoStore;
  const newId = deps.newId ?? randomUUID;
  const seed = buildDemoSeed(newId(), (deps.now ?? (() => new Date()))(), newId);
  await store.insertSeed(seed);
  return { userId: seed.user.id, projectId: seed.project.id };
}

export async function isDemoUser(userId: string, deps: DemoDeps = {}): Promise<boolean> {
  return (await (deps.store ?? drizzleDemoStore).sessionIdForUser(userId)) !== null;
}

/** Counts one AI call against a demo session; a no-op for real users. */
export async function chargeDemoAi(userId: string, deps: DemoDeps = {}): Promise<void> {
  const store = deps.store ?? drizzleDemoStore;
  const sessionId = await store.sessionIdForUser(userId);
  if (!sessionId) return;
  if ((await store.incrementAiCalls(sessionId)) > DEMO_AI_LIMIT) throw new DemoLimitError();
}

export async function withDemoBudget<T>(userId: string, fn: () => Promise<T>, deps: DemoDeps = {}): Promise<T> {
  await chargeDemoAi(userId, deps);
  return fn();
}

export async function cleanupOldDemos(olderThanHours = 24, deps: DemoDeps = {}): Promise<number> {
  const store = deps.store ?? drizzleDemoStore;
  const now = (deps.now ?? (() => new Date()))();
  const ids = await store.expiredSessions(new Date(now.getTime() - olderThanHours * HOUR));
  if (ids.length) await store.deleteSessions(ids);
  return ids.length;
}

/** In-memory fixed-window limiter; per server instance, which is enough to blunt demo spam. */
export function createRateLimiter(max: number, windowMs: number, clock: () => number = Date.now) {
  const hits = new Map<string, { start: number; count: number }>();
  return (key: string): boolean => {
    const t = clock();
    for (const [k, v] of hits) if (t - v.start > windowMs) hits.delete(k);
    const entry = hits.get(key) ?? { start: t, count: 0 };
    hits.set(key, entry);
    return ++entry.count <= max;
  };
}

export const drizzleDemoStore: DemoStore = {
  async insertSeed(seed) {
    await db.batch([
      db.insert(demoSessions).values(seed.session),
      db.insert(users).values(seed.user),
      db.insert(projects).values(seed.project),
      db.insert(projectRepos).values(seed.repo),
      db.insert(events).values(seed.events),
      db.insert(changeCards).values(seed.cards),
      db.insert(voiceProfiles).values(seed.profiles),
      db.insert(voiceRules).values(seed.rules),
      db.insert(drafts).values(seed.drafts),
    ]);
  },
  async sessionIdForUser(userId) {
    const [row] = await db.select({ account: users.bufferAccountId }).from(users).where(eq(users.id, userId)).limit(1);
    return row?.account.startsWith(ACCOUNT_PREFIX) ? row.account.slice(ACCOUNT_PREFIX.length) : null;
  },
  async incrementAiCalls(sessionId) {
    const [row] = await db
      .update(demoSessions)
      .set({ aiCalls: sql`${demoSessions.aiCalls} + 1` })
      .where(eq(demoSessions.id, sessionId))
      .returning({ aiCalls: demoSessions.aiCalls });
    // A missing session row means it was cleaned up: treat the budget as spent.
    return row?.aiCalls ?? Number.POSITIVE_INFINITY;
  },
  async expiredSessions(before) {
    const rows = await db.select({ id: demoSessions.id }).from(demoSessions).where(lt(demoSessions.createdAt, before));
    return rows.map((r) => r.id);
  },
  async deleteSessions(ids) {
    const accounts = ids.map((id) => `${ACCOUNT_PREFIX}${id}`);
    const demoDrafts = db
      .select({ id: drafts.id })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .where(inArray(users.bufferAccountId, accounts));
    // posts.draft_id has no cascade, so posts go first; users cascade to projects, drafts, voice rows.
    await db.batch([
      db.delete(posts).where(inArray(posts.draftId, demoDrafts)),
      db.delete(events).where(inArray(events.repoFullName, ids.map(demoRepoName))),
      db.delete(users).where(inArray(users.bufferAccountId, accounts)),
      db.delete(demoSessions).where(inArray(demoSessions.id, ids)),
    ]);
  },
};
