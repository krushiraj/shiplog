import { and, eq, gte, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, changeCards, drafts, events, projectRepos, projects, users } from "@/db/schema";
import { utcDayStart } from "@/lib/ai/budget";
import { maybeAutoPublish } from "@/lib/autopost";
import { compose as realCompose } from "@/lib/compose";
import { parseDuration, resolveConfig, type PartialConfig } from "@/lib/config";
import { isDigestDue, isInstant, selectCards, type InstantEvent } from "@/lib/schedule";

const CLAIM_MS = 5 * 60_000;
const ANALYSE_CAP = 20;
/** Cards in a draft with one of these statuses stay out of new drafts; expired and snoozed ones return to the pool. */
export const HOLDING_STATUSES = ["pending", "approved", "posted", "failed", "rejected"];

export type TickCard = {
  id: string;
  significance: number;
  occurredAt: Date;
  cancelled: boolean;
  event: { kind: string; ref: string; payload: unknown };
};

export type TickProject = {
  id: string;
  userDefaults: Record<string, unknown>;
  projectConfig: Record<string, unknown>;
  lastDigestAt: Date | null;
  repos: string[];
};

export interface TickStore {
  /** Atomically claims unclaimed, unpaused projects until `until` (only `onlyIds` when given); returns the ids this caller won. */
  claimProjects(now: Date, until: Date, onlyIds?: string[]): Promise<string[]>;
  loadProject(id: string): Promise<TickProject | null>;
  /** Cards since `since` that are in no draft of this project. */
  instantCandidates(projectId: string, repos: string[], since: Date): Promise<TickCard[]>;
  /** Non-cancelled cards since `since` not held by a draft of this project with one of `holding` statuses. */
  digestCandidates(projectId: string, repos: string[], holding: string[], since: Date): Promise<TickCard[]>;
  setLastDigestAt(projectId: string, at: Date): Promise<void>;
  expireDrafts(projectId: string, before: Date): Promise<number>;
}

export type TickDeps = {
  store?: TickStore;
  analyse?: (limit: number) => Promise<unknown>;
  compose?: (projectId: string, cardIds: string[], trigger: string) => Promise<{ draftId: string }>;
  autoPublish?: (draftId: string) => Promise<unknown>;
  /** Limit the tick to these projects (event- or visit-driven ticks). Omit for every project. */
  projectIds?: string[];
  /** Total AI spend (all users) since `since`. */
  aiCostSince?: (since: Date) => Promise<number>;
  now?: () => Date;
};

export type TickSummary = { claimed: string[]; drafts: string[]; expired: number; errors: string[]; aiCostTodayUsd: number | null };

export async function runTick(deps: TickDeps = {}): Promise<TickSummary> {
  const store = deps.store ?? drizzleTickStore;
  const compose = deps.compose ?? ((p, c, t) => realCompose(p, c, t));
  const autoPublish = deps.autoPublish ?? ((id) => maybeAutoPublish(id));
  const now = (deps.now ?? (() => new Date()))();
  const summary: TickSummary = { claimed: [], drafts: [], expired: 0, errors: [], aiCostTodayUsd: null };

  if (deps.analyse) {
    try {
      await deps.analyse(ANALYSE_CAP);
    } catch (e) {
      summary.errors.push(`analyse: ${(e as Error).message}`);
    }
  }

  if (deps.projectIds?.length === 0) return summary;
  summary.claimed = await store.claimProjects(now, new Date(now.getTime() + CLAIM_MS), deps.projectIds);

  const draft = async (projectId: string, cardIds: string[], trigger: string) => {
    const { draftId } = await compose(projectId, cardIds, trigger);
    summary.drafts.push(draftId);
    try {
      await autoPublish(draftId);
    } catch (e) {
      summary.errors.push(`${projectId}: auto-publish ${draftId}: ${(e as Error).message}`);
    }
  };

  for (const id of summary.claimed) {
    try {
      const project = await store.loadProject(id);
      if (!project) continue;
      const config = resolveConfig(project.userDefaults as PartialConfig, project.projectConfig as PartialConfig);
      const { digest, instant } = config.triggers;

      summary.expired += await store.expireDrafts(id, new Date(now.getTime() - parseDuration(config.review.expire_after)));

      const since = new Date(now.getTime() - parseDuration(digest.max_age));
      if (instant.length) {
        for (const card of await store.instantCandidates(id, project.repos, since)) {
          if (card.cancelled || !isInstant(instant, card.event as InstantEvent, card)) continue;
          await draft(id, [card.id], `instant:${card.event.kind}`);
        }
      }

      if (isDigestDue(digest, config.timezone, project.lastDigestAt, now)) {
        const pool = await store.digestCandidates(id, project.repos, HOLDING_STATUSES, since);
        const picked = selectCards(pool, digest, now);
        // Mark the slot even when skipped: below-threshold cards carry forward to the next digest.
        await store.setLastDigestAt(id, now);
        if (picked.post) await draft(id, picked.cards.map((c) => c.id), "digest");
      }
    } catch (e) {
      summary.errors.push(`${id}: ${(e as Error).message}`);
    }
  }

  try {
    summary.aiCostTodayUsd = await (deps.aiCostSince ?? aiCostSince)(utcDayStart(now));
  } catch (e) {
    console.warn("Could not total today's AI cost", e);
  }
  return summary;
}

async function aiCostSince(since: Date): Promise<number> {
  const [row] = await db
    .select({ total: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)` })
    .from(aiUsage)
    .where(gte(aiUsage.createdAt, since));
  return Number(row?.total ?? 0);
}

const cardColumns = {
  id: changeCards.id,
  significance: changeCards.significance,
  occurredAt: changeCards.occurredAt,
  cancelled: changeCards.cancelled,
  kind: events.kind,
  ref: events.ref,
  payload: events.payload,
};

type CardRow = { id: string; significance: number; occurredAt: Date; cancelled: boolean; kind: string; ref: string; payload: unknown };
const toCard = ({ kind, ref, payload, ...c }: CardRow): TickCard => ({ ...c, event: { kind, ref, payload } });

function notInDraft(projectId: string, statuses?: string[]) {
  const statusFilter = statuses ? sql` and d.status in (${sql.join(statuses.map((s) => sql`${s}`), sql`, `)})` : sql``;
  return sql`not exists (select 1 from ${drafts} d where d.project_id = ${projectId} and d.card_ids @> jsonb_build_array(${changeCards.id}::text)${statusFilter})`;
}

async function cardsFor(repos: string[], since: Date, exclusion: ReturnType<typeof notInDraft>) {
  if (!repos.length) return [];
  const rows = await db
    .select(cardColumns)
    .from(changeCards)
    .innerJoin(events, eq(events.id, changeCards.eventId))
    .where(
      and(
        inArray(changeCards.repoFullName, repos),
        gte(changeCards.occurredAt, since),
        eq(changeCards.cancelled, false),
        exclusion,
      ),
    );
  return rows.map(toCard);
}

export const drizzleTickStore: TickStore = {
  async claimProjects(now, until, onlyIds) {
    if (onlyIds?.length === 0) return [];
    const rows = await db
      .update(projects)
      .set({ claimedUntil: until })
      .where(
        and(
          eq(projects.paused, false),
          eq(projects.isDemo, false),
          or(isNull(projects.claimedUntil), lt(projects.claimedUntil, now)),
          onlyIds ? inArray(projects.id, onlyIds) : undefined,
        ),
      )
      .returning({ id: projects.id });
    return rows.map((r) => r.id);
  },
  async loadProject(id) {
    const [row] = await db
      .select({ project: projects, defaults: users.defaults })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(projects.id, id));
    if (!row) return null;
    const repos = await db.select({ name: projectRepos.repoFullName }).from(projectRepos).where(eq(projectRepos.projectId, id));
    return {
      id,
      userDefaults: row.defaults,
      projectConfig: row.project.config,
      lastDigestAt: row.project.lastDigestAt,
      repos: repos.map((r) => r.name),
    };
  },
  instantCandidates: (projectId, repos, since) => cardsFor(repos, since, notInDraft(projectId)),
  digestCandidates: (projectId, repos, holding, since) => cardsFor(repos, since, notInDraft(projectId, holding)),
  async setLastDigestAt(projectId, at) {
    await db.update(projects).set({ lastDigestAt: at }).where(eq(projects.id, projectId));
  },
  async expireDrafts(projectId, before) {
    const rows = await db
      .update(drafts)
      .set({ status: "expired" })
      .where(and(eq(drafts.projectId, projectId), eq(drafts.status, "pending"), lt(drafts.createdAt, before)))
      .returning({ id: drafts.id });
    return rows.length;
  },
};

/**
 * Ticks only the projects that watch these events' repos. Called right after a webhook's events are analysed, so an
 * instant post or a due digest doesn't wait for the 15-minute cron (GitHub's scheduled workflows can lag by hours).
 */
export async function tickForEvents(eventIds: string[]): Promise<TickSummary | null> {
  if (!eventIds.length) return null;
  const rows = await db
    .selectDistinct({ id: projectRepos.projectId })
    .from(projectRepos)
    .innerJoin(events, eq(events.repoFullName, projectRepos.repoFullName))
    .where(inArray(events.id, eventIds));
  return rows.length ? runTick({ projectIds: rows.map((r) => r.id) }) : null;
}

/** Ticks a user's projects when they open the app, as a second fallback for a late cron. */
export async function tickForUser(userId: string): Promise<TickSummary | null> {
  const rows = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.userId, userId), eq(projects.isDemo, false)));
  return rows.length ? runTick({ projectIds: rows.map((r) => r.id) }) : null;
}
