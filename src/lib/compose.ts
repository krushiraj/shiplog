import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { changeCards, drafts, projects, users, voiceProfiles, voiceRules, type CachedChannel } from "@/db/schema";
import { callJson as realCallJson, type Usage } from "@/lib/ai/claude";
import { fallbackDraft } from "@/lib/ai/fallback";
import { composePrompt, voiceCheckPrompt, type CardInput } from "@/lib/ai/prompts";
import { ComposeSchema, VoiceCheckSchema, type Brief } from "@/lib/ai/schemas";
import { resolveTargets } from "@/lib/channels";
import { resolveConfig, type PartialConfig } from "@/lib/config";
import { gate, type Violation } from "@/lib/gate";

export type ComposeCard = {
  id: string;
  repoFullName: string;
  what: string;
  why: string | null;
  how: string | null;
  impact: string | null;
  significance: number;
  answer: string | null;
};

export type ComposeContext = {
  project: { id: string; name: string; userId: string; isDemo: boolean };
  userDefaults: Record<string, unknown>;
  projectConfig: Record<string, unknown>;
  brief: Record<string, unknown> | null;
  cards: ComposeCard[];
  channels: CachedChannel[];
  voiceProfiles: { projectId: string | null; register: string; dna: Record<string, unknown> }[];
  rules: { kind: string; rule: string; pattern: string | null; register: string | null }[];
  recentPosts: string[];
};

export type ChannelGate = { fixed: string[]; violations: Violation[]; blocked: boolean };

export type DraftGate = {
  channels: Record<string, ChannelGate>;
  targets: { channelId: string; key: string }[];
  voiceScore: Record<string, number>;
  suggestions: Record<string, string[]>;
  themes: string[];
  fallback: boolean;
  usage: Usage;
};

export type NewDraft = {
  projectId: string;
  trigger: string;
  cardIds: string[];
  variants: Record<string, string>;
  gate: DraftGate & Record<string, unknown>;
  status: "pending";
};

export interface ComposeStore {
  load(projectId: string, cardIds: string[]): Promise<ComposeContext>;
  insertDraft(draft: NewDraft): Promise<string>;
}

export type ComposeDeps = { store?: ComposeStore; callJson?: typeof realCallJson };

export type ComposeResult = {
  draftId: string;
  variants: Record<string, string>;
  gate: Record<string, ChannelGate>;
  voiceScore: Record<string, number>;
  suggestions: Record<string, string[]>;
};

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

function toCardInput(c: ComposeCard): CardInput {
  const why = [c.why, c.answer && `Author: ${c.answer}`].filter(Boolean).join(" ") || null;
  return { what: c.what, why, how: c.how, impact: c.impact, significance: c.significance };
}

export async function compose(
  projectId: string,
  cardIds: string[],
  trigger: string,
  opts: { nudge?: string | null } = {},
  deps: ComposeDeps = {},
): Promise<ComposeResult> {
  const store = deps.store ?? drizzleComposeStore;
  const callJson = deps.callJson ?? realCallJson;
  const ctx = await store.load(projectId, cardIds);
  const config = resolveConfig(ctx.userDefaults as PartialConfig, ctx.projectConfig as PartialConfig);

  const targets = resolveTargets(config.channels, ctx.channels, config);
  const specs = [...new Map(targets.map((t) => [t.key, { key: t.key, register: t.register, limit: t.limit }])).values()];

  // Project-level DNA overrides user-level DNA for the same register.
  const dnaByRegister: Record<string, Record<string, unknown>> = {};
  for (const p of [...ctx.voiceProfiles].sort((a, b) => Number(a.projectId !== null) - Number(b.projectId !== null))) {
    dnaByRegister[p.register] = p.dna;
  }
  const registers = new Set(specs.map((s) => s.register));
  const dna = Object.fromEntries(Object.entries(dnaByRegister).filter(([r]) => registers.has(r)));
  const examples = Object.fromEntries(
    Object.entries(dna).map(([r, d]) => [r, Array.isArray(d.examples) ? (d.examples as string[]) : []]),
  );
  const activeRules = ctx.rules.filter((r) => !r.register || registers.has(r.register));
  const repo = ctx.cards[0]?.repoFullName;
  const link = config.posting.link !== "none" && repo ? `https://github.com/${repo}` : null;

  let usage = ZERO;
  let themes: string[] = [];
  let aiVariants: Record<string, string> = {};
  let fallback = false;
  try {
    const prompt = composePrompt({
      brief: ctx.brief as Brief | null,
      cards: ctx.cards.map(toCardInput),
      voice: { dna, activeRules, examples },
      channels: specs,
      recentPosts: ctx.recentPosts,
      trigger,
      nudge: opts.nudge,
      hashtags: config.posting.hashtags,
      link,
    });
    const res = await callJson(ComposeSchema, { ...prompt, maxTokens: 2000, cacheSystem: true });
    usage = addUsage(usage, res.usage);
    aiVariants = res.data.variants;
    themes = res.data.themes;
  } catch {
    fallback = true;
  }

  const variants: Record<string, string> = {};
  const gates: Record<string, ChannelGate> = {};
  for (const spec of specs) {
    const raw = aiVariants[spec.key]?.trim() || fallbackDraft(ctx.cards, spec.key, spec.limit, ctx.project.name);
    const rules = activeRules.filter((r) => !r.register || r.register === spec.register);
    const g = gate(raw, { channel: spec.key, rules: rules as Parameters<typeof gate>[1]["rules"], hashtags: [] });
    variants[spec.key] = g.text;
    gates[spec.key] = { fixed: g.fixed, violations: g.violations, blocked: g.blocked };
  }

  let voiceScore: Record<string, number> = {};
  let suggestions: Record<string, string[]> = {};
  if (!fallback && specs.length) {
    try {
      const voice = Object.fromEntries(specs.map((s) => [s.key, dna[s.register] ?? {}]));
      const res = await callJson(VoiceCheckSchema, { ...voiceCheckPrompt({ drafts: variants, voice }), maxTokens: 600, effort: "low" });
      usage = addUsage(usage, res.usage);
      // The model scores drift (0 = sounds like the author); we store similarity so higher is better.
      voiceScore = Object.fromEntries(Object.entries(res.data.scores).map(([k, drift]) => [k, 1 - drift]));
      suggestions = res.data.suggestions;
    } catch {}
  }

  const draftGate: DraftGate = {
    channels: gates,
    targets: targets.map((t) => ({ channelId: t.channelId, key: t.key })),
    voiceScore,
    suggestions,
    themes,
    fallback,
    usage,
  };
  const draftId = await store.insertDraft({ projectId, trigger, cardIds, variants, gate: draftGate, status: "pending" });
  return { draftId, variants, gate: gates, voiceScore, suggestions };
}

export const drizzleComposeStore: ComposeStore = {
  async load(projectId, cardIds) {
    const [row] = await db
      .select({ project: projects, user: users })
      .from(projects)
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(projects.id, projectId));
    if (!row) throw new Error(`Project ${projectId} not found`);
    const { project, user } = row;

    const [cards, profiles, rules, recent] = await Promise.all([
      cardIds.length ? db.select().from(changeCards).where(inArray(changeCards.id, cardIds)) : Promise.resolve([]),
      db
        .select()
        .from(voiceProfiles)
        .where(and(eq(voiceProfiles.userId, user.id), or(isNull(voiceProfiles.projectId), eq(voiceProfiles.projectId, projectId)))),
      db
        .select()
        .from(voiceRules)
        .where(and(eq(voiceRules.userId, user.id), eq(voiceRules.active, true), or(isNull(voiceRules.projectId), eq(voiceRules.projectId, projectId)))),
      db
        .select({ variants: drafts.variants, finalText: drafts.finalText })
        .from(drafts)
        .where(and(eq(drafts.projectId, projectId), eq(drafts.status, "posted")))
        .orderBy(desc(drafts.createdAt))
        .limit(5),
    ]);

    return {
      project: { id: project.id, name: project.name, userId: user.id, isDemo: project.isDemo },
      userDefaults: user.defaults,
      projectConfig: project.config,
      brief: project.brief,
      cards,
      channels: user.channels ?? [],
      voiceProfiles: profiles,
      rules,
      recentPosts: recent.map((d) => Object.values(d.finalText ?? d.variants)[0]).filter((t): t is string => !!t),
    };
  },
  async insertDraft(draft) {
    const [row] = await db.insert(drafts).values(draft).returning({ id: drafts.id });
    return row.id;
  },
};
