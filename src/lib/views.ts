import { and, desc, eq, gte, inArray, isNull, or, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db } from "@/db";
import { changeCards, drafts, events, posts, projectRepos, projects, users, voiceProfiles, voiceRules } from "@/db/schema";
import { channelKey, resolveTargets } from "@/lib/channels";
import { resolveConfig, type PartialConfig, type ProjectConfig } from "@/lib/config";
import { displayRepo } from "@/lib/demo";
import { getSessionUserId } from "@/lib/session";
import {
  CHANNELS,
  type BriefView,
  type ChangeCardView,
  type ChannelKey,
  type DraftView,
  type PostRow,
  type ProjectView,
  type Significance,
  type VoiceRuleView,
} from "@/lib/ui-types";

export const BUFFER_APP_URL = "https://publish.buffer.com";
const DAY_MS = 86_400_000;

type CardRow = typeof changeCards.$inferSelect;
type DraftRow = typeof drafts.$inferSelect;
type EventRef = { kind: string; ref: string; payload: unknown };
type DraftGateLike = {
  channels?: Record<string, { fixed?: string[]; limit?: number }>;
  targets?: { channelId: string; key: string }[];
  voiceScore?: Record<string, number>;
  suggestions?: Record<string, string[]>;
  suggestionDecisions?: Record<string, boolean>;
  autoHeld?: string;
};

const isChannelKey = (k: string): k is ChannelKey => k in CHANNELS;
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export async function requireUserId(): Promise<string> {
  const userId = await getSessionUserId();
  if (!userId) redirect("/api/auth/buffer/start");
  return userId;
}

// ---------- pure mappers ----------

export function toCardView(card: CardRow, event: EventRef | null): ChangeCardView {
  const repo = displayRepo(card.repoFullName);
  const base = `https://github.com/${repo}`;
  const payload = (event?.payload ?? {}) as { url?: unknown };
  const ref = event?.ref ?? "";
  let view: Pick<ChangeCardView, "ref" | "kind" | "url">;
  switch (event?.kind) {
    case "pr_merged":
      view = { ref: `#${ref}`, kind: "pr_merged", url: `${base}/pull/${ref}` };
      break;
    case "issue_closed":
      view = { ref: `#${ref}`, kind: "issue_closed", url: `${base}/issues/${ref}` };
      break;
    case "release":
      view = { ref, kind: "release", url: `${base}/releases/tag/${ref}` };
      break;
    case "tag":
      view = { ref, kind: "tag", url: `${base}/tree/${ref}` };
      break;
    case "commit":
    case "revert":
      view = { ref: ref.slice(0, 7), kind: "commit", url: `${base}/commit/${ref}` };
      break;
    default:
      view = { ref: repo, kind: "commit", url: base };
  }
  if (typeof payload.url === "string") view.url = payload.url;
  return {
    id: card.id,
    repo,
    ...view,
    what: card.what,
    why: card.answer ?? card.why,
    whyInferred: card.answer ? false : card.whyInferred,
    how: card.how,
    impact: card.impact,
    significance: Math.max(0, Math.min(3, card.significance)) as Significance,
    occurredAt: card.occurredAt.toISOString(),
  };
}

const textsOf = (d: Pick<DraftRow, "variants" | "finalText">) => ({ ...d.variants, ...d.finalText });

function slotOf(draft: Pick<DraftRow, "scheduledFor" | "createdAt">, config: ProjectConfig): DraftView["slot"] {
  if (draft.scheduledFor) {
    const iso = draft.scheduledFor.toISOString();
    const label = draft.scheduledFor.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: config.timezone });
    return { label, iso };
  }
  const iso = draft.createdAt.toISOString();
  const when = config.posting.when;
  if (when === "now") return { label: "Posts on approve", iso };
  if (when === "next_best_slot") return { label: "Next free Buffer slot", iso };
  return { label: `${when} ${config.timezone}`, iso };
}

function triggerOf(trigger: string, cards: ChangeCardView[]): DraftView["trigger"] {
  if (trigger === "instant:release") {
    const rel = cards.find((c) => c.kind === "release" || c.kind === "tag");
    return { kind: "release", label: rel ? `Release ${rel.ref}` : "New release" };
  }
  if (trigger.startsWith("instant:")) return { kind: "instant", label: `Instant post · ${trigger.slice(8).replace(/_/g, " ")}` };
  if (trigger === "manual") return { kind: "digest", label: `Written on request · ${plural(cards.length, "change")}` };
  return { kind: "digest", label: `Digest · ${plural(cards.length, "change")}` };
}

export function toDraftView(input: {
  draft: DraftRow;
  project: { id: string; name: string };
  cards: ChangeCardView[];
  rawCards: CardRow[];
  config: ProjectConfig;
}): DraftView {
  const { draft, project, cards, rawCards, config } = input;
  const gate = (draft.gate ?? {}) as DraftGateLike;
  const variants: DraftView["variants"] = {};
  for (const [k, v] of Object.entries(textsOf(draft))) if (isChannelKey(k)) variants[k] = v;
  const keys = Object.keys(variants);

  const scores = keys.map((k) => gate.voiceScore?.[k]).filter((s): s is number => typeof s === "number");
  const drift = scores.length ? 1 - Math.min(...scores) : 0;
  const fixed = [...new Set(keys.flatMap((k) => gate.channels?.[k]?.fixed ?? []))];
  if (gate.autoHeld) fixed.unshift(`Held from auto: ${gate.autoHeld}`);
  const suggestions = keys.flatMap((k) =>
    (gate.suggestions?.[k] ?? [])
      .map((text, i) => ({ id: `${k}:${i}`, text }))
      .filter((s) => gate.suggestionDecisions?.[s.id] !== false),
  );
  const open = rawCards.find((c) => c.openQuestion && !c.answer);

  return {
    id: draft.id,
    project,
    trigger: triggerOf(draft.trigger, cards),
    slot: slotOf(draft, config),
    variants,
    cards,
    openQuestion: open ? { cardId: open.id, question: open.openQuestion! } : null,
    gate: { drift, suggestions, fixed },
    limits: Object.fromEntries(keys.flatMap((k) => (gate.channels?.[k]?.limit ? [[k, gate.channels[k].limit]] : []))),
    createdAt: draft.createdAt.toISOString(),
  };
}

export function toPostRow(input: {
  post: { id: string; channelId: string; bufferPostId: string | null; status: string; createdAt: Date };
  draft: Pick<DraftRow, "variants" | "finalText" | "gate" | "scheduledFor">;
  projectName: string;
  sources: PostRow["sources"];
}): PostRow | null {
  const { post, draft } = input;
  const targets = (draft.gate as DraftGateLike | null)?.targets ?? [];
  const key = targets.find((t) => t.channelId === post.channelId)?.key ?? (isChannelKey(post.channelId) ? post.channelId : null);
  if (!key || !isChannelKey(key)) return null;
  const text = textsOf(draft)[key] ?? "";
  const status: PostRow["status"] = post.status === "sent" || post.status === "error" ? post.status : "queued";
  const real = post.bufferPostId && !post.bufferPostId.startsWith("demo_");
  return {
    id: post.id,
    project: input.projectName,
    channel: key,
    excerpt: text.length > 280 ? `${text.slice(0, 279)}…` : text,
    status,
    at: (draft.scheduledFor ?? post.createdAt).toISOString(),
    bufferUrl: real ? BUFFER_APP_URL : null,
    sources: input.sources,
  };
}

export function toRuleView(r: { id: string; kind: string; rule: string; register: string | null; sightings: number; active: boolean; sourceDraftId: string | null }): VoiceRuleView {
  return {
    id: r.id,
    kind: (["never", "prefer", "format"].includes(r.kind) ? r.kind : "prefer") as VoiceRuleView["kind"],
    rule: r.rule,
    register: r.register,
    source: r.sourceDraftId ? `Learned from draft ${r.sourceDraftId.slice(0, 8)}` : "Added by you",
    sightings: r.sightings,
    active: r.active,
  };
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const str = (v: unknown) => (typeof v === "string" ? v : "");

export function toBriefView(brief: Record<string, unknown> | null): BriefView {
  const b = brief ?? {};
  const pairs = <K extends string>(v: unknown, a: K, c: K) =>
    (Array.isArray(v) ? v : []).filter((x) => x && typeof x === "object").map((x) => ({ [a]: str(x[a]), [c]: str(x[c]) }) as Record<K, string>);
  return {
    pitch: str(b.pitch),
    audience: str(b.audience),
    problem: str(b.problem),
    stack: strings(b.stack),
    glossary: pairs(b.glossary, "term", "plain") as BriefView["glossary"],
    architecture: pairs(b.architecture, "module", "purpose") as BriefView["architecture"],
    milestones: strings(b.milestones),
    facts: strings(b.facts),
  };
}

export function cadenceLabel(config: ProjectConfig): string {
  const { every, at } = config.triggers.digest;
  if (every === "off") return "Releases only";
  if (every === "1d") return `Daily digest at ${at}`;
  if (every === "2d") return `Every 2 days at ${at}`;
  return `Weekly on ${every.slice(7)} at ${at}`;
}

/** Consecutive UTC days with at least one change, ending today (or yesterday, so the streak survives until tonight). */
export function streakDays(dates: Date[], now: Date): number {
  const days = new Set(dates.map((d) => Math.floor(d.getTime() / DAY_MS)));
  let day = Math.floor(now.getTime() / DAY_MS);
  if (!days.has(day)) day--;
  let streak = 0;
  while (days.has(day - streak)) streak++;
  return streak;
}

// ---------- loaders ----------

async function getUser(userId: string) {
  const [user] = await db.select().from(users).where(eq(users.id, userId));
  return user ?? null;
}

const configFor = (user: { defaults: Record<string, unknown> } | null, project: { config: Record<string, unknown> }) =>
  resolveConfig((user?.defaults ?? {}) as PartialConfig, project.config as PartialConfig);

async function loadCards(ids: string[]) {
  if (!ids.length) return new Map<string, { row: CardRow; view: ChangeCardView }>();
  const rows = await db
    .select({ card: changeCards, event: { kind: events.kind, ref: events.ref, payload: events.payload } })
    .from(changeCards)
    .leftJoin(events, eq(events.id, changeCards.eventId))
    .where(inArray(changeCards.id, ids));
  return new Map(rows.map((r) => [r.card.id, { row: r.card, view: toCardView(r.card, r.event) }]));
}

function pick<T>(map: Map<string, T>, ids: string[]): T[] {
  return ids.flatMap((id) => (map.has(id) ? [map.get(id)!] : []));
}

export async function loadInbox(userId: string): Promise<DraftView[]> {
  const [user, rows] = await Promise.all([
    getUser(userId),
    db
      .select({ draft: drafts, project: projects })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .where(and(eq(projects.userId, userId), eq(drafts.status, "pending")))
      .orderBy(desc(drafts.createdAt)),
  ]);
  const cards = await loadCards([...new Set(rows.flatMap((r) => r.draft.cardIds))]);
  return rows.map(({ draft, project }) => {
    const used = pick(cards, draft.cardIds);
    return toDraftView({
      draft,
      project: { id: project.id, name: project.name },
      cards: used.map((c) => c.view),
      rawCards: used.map((c) => c.row),
      config: configFor(user, project),
    });
  });
}

export async function inboxCount(userId: string): Promise<number> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .where(and(eq(projects.userId, userId), eq(drafts.status, "pending")));
  return row?.n ?? 0;
}

export async function loadTimeline(userId: string): Promise<PostRow[]> {
  const rows = await db
    .select({ post: posts, draft: drafts, projectName: projects.name })
    .from(posts)
    .innerJoin(drafts, eq(drafts.id, posts.draftId))
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .where(eq(projects.userId, userId))
    .orderBy(desc(posts.createdAt))
    .limit(200);
  const cards = await loadCards([...new Set(rows.flatMap((r) => r.draft.cardIds))]);
  return rows.flatMap(({ post, draft, projectName }) => {
    const sources = pick(cards, draft.cardIds).map(({ view }) => ({ ref: view.ref, url: view.url }));
    const row = toPostRow({ post, draft, projectName, sources });
    return row ? [row] : [];
  });
}

export async function loadProjects(userId: string): Promise<ProjectView[]> {
  const [user, rows] = await Promise.all([getUser(userId), db.select().from(projects).where(eq(projects.userId, userId))]);
  if (!rows.length) return [];
  const ids = rows.map((p) => p.id);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const repoRows = await db.select().from(projectRepos).where(inArray(projectRepos.projectId, ids));
  const allRepos = [...new Set(repoRows.map((r) => r.repoFullName))];
  const [cardRows, postRows] = await Promise.all([
    allRepos.length
      ? db
          .select({ repo: changeCards.repoFullName, at: changeCards.occurredAt })
          .from(changeCards)
          .where(and(inArray(changeCards.repoFullName, allRepos), gte(changeCards.occurredAt, new Date(now.getTime() - 60 * DAY_MS))))
      : Promise.resolve([]),
    db
      .select({ projectId: drafts.projectId })
      .from(posts)
      .innerJoin(drafts, eq(drafts.id, posts.draftId))
      .where(and(inArray(drafts.projectId, ids), gte(posts.createdAt, weekAgo))),
  ]);

  return rows.map((p) => {
    const config = configFor(user, p);
    const repos = repoRows.filter((r) => r.projectId === p.id).map((r) => r.repoFullName);
    const dates = cardRows.filter((c) => repos.includes(c.repo)).map((c) => c.at);
    const shown = [...new Set(repos.map(displayRepo))];
    const channels = [...new Set(resolveTargets(config.channels, user?.channels ?? [], config).map((t) => t.key))].filter(isChannelKey);
    return {
      id: p.id,
      name: p.name,
      repos: shown,
      channels,
      cadence: cadenceLabel(config),
      reviewMode: config.review.mode,
      paused: p.paused,
      stats: {
        changesThisWeek: dates.filter((d) => d >= weekAgo).length,
        postsThisWeek: postRows.filter((r) => r.projectId === p.id).length,
        streakDays: streakDays(dates, now),
      },
    };
  });
}

export type VoiceProfileView = { id: string; register: string; scope: "you" | "project"; dna: Record<string, unknown> };
export type MemoryCardView = ChangeCardView & { openQuestion: string | null };

export type MemoryData = {
  project: { id: string; name: string } | null;
  projects: { id: string; name: string }[];
  brief: BriefView;
  cards: MemoryCardView[];
  rules: VoiceRuleView[];
  profiles: VoiceProfileView[];
};

export async function loadMemory(userId: string, projectId?: string | null): Promise<MemoryData> {
  const all = await db.select({ id: projects.id, name: projects.name, brief: projects.brief }).from(projects).where(eq(projects.userId, userId));
  const project = all.find((p) => p.id === projectId) ?? all[0] ?? null;
  const scope = project ? or(isNull(voiceRules.projectId), eq(voiceRules.projectId, project.id)) : isNull(voiceRules.projectId);
  const profileScope = project
    ? or(isNull(voiceProfiles.projectId), eq(voiceProfiles.projectId, project.id))
    : isNull(voiceProfiles.projectId);

  const [repoRows, ruleRows, profileRows] = await Promise.all([
    project ? db.select({ repo: projectRepos.repoFullName }).from(projectRepos).where(eq(projectRepos.projectId, project.id)) : Promise.resolve([]),
    db.select().from(voiceRules).where(and(eq(voiceRules.userId, userId), scope)).orderBy(desc(voiceRules.lastSeenAt)),
    db.select().from(voiceProfiles).where(and(eq(voiceProfiles.userId, userId), profileScope)),
  ]);
  const repos = repoRows.map((r) => r.repo);
  const cardRows = repos.length
    ? await db
        .select({ card: changeCards, event: { kind: events.kind, ref: events.ref, payload: events.payload } })
        .from(changeCards)
        .leftJoin(events, eq(events.id, changeCards.eventId))
        .where(and(inArray(changeCards.repoFullName, repos), eq(changeCards.cancelled, false)))
        .orderBy(desc(changeCards.occurredAt))
        .limit(100)
    : [];

  return {
    project: project && { id: project.id, name: project.name },
    projects: all.map(({ id, name }) => ({ id, name })),
    brief: toBriefView(project?.brief ?? null),
    cards: cardRows.map((r) => ({ ...toCardView(r.card, r.event), openQuestion: r.card.answer ? null : r.card.openQuestion })),
    rules: ruleRows.map(toRuleView),
    profiles: profileRows.map((p) => ({ id: p.id, register: p.register, scope: p.projectId ? "project" : "you", dna: p.dna })),
  };
}

export type SettingsData = {
  project: ProjectView;
  config: ProjectConfig;
  /** Buffer channels the user can pick, by UI channel key. */
  availableChannels: { id: string; key: ChannelKey; name: string }[];
};

export async function loadSettings(userId: string, projectId?: string | null): Promise<SettingsData | null> {
  const [user, list] = await Promise.all([getUser(userId), loadProjects(userId)]);
  const project = list.find((p) => p.id === projectId) ?? list[0];
  if (!project) return null;
  const [row] = await db.select().from(projects).where(eq(projects.id, project.id));
  const cached = (user?.channels ?? []).flatMap((c) => {
    const key = channelKey(c.service);
    return isChannelKey(key) && !c.isDisconnected ? [{ id: c.id, key, name: c.displayName ?? c.name }] : [];
  });
  // Demo projects (and users with no cached channels) configure channels by key.
  const availableChannels = cached.length && !row.isDemo
    ? cached
    : (Object.keys(CHANNELS) as ChannelKey[]).map((key) => ({ id: key, key, name: CHANNELS[key].label }));
  return { project, config: configFor(user, row), availableChannels };
}

export async function loadAccount(userId: string) {
  const user = await getUser(userId);
  const email = user?.email ?? "";
  const name = email ? email.split("@")[0] : "Buffer account";
  return { name, email, initials: name.slice(0, 2).toUpperCase() };
}
