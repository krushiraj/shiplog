import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { drafts, projects, users, voiceProfiles, voiceRules } from "@/db/schema";
import { callJson as realCallJson } from "@/lib/ai/claude";
import { ruleProposalPrompt } from "@/lib/ai/prompts";
import { RuleProposalsSchema } from "@/lib/ai/schemas";
import { registerFor } from "@/lib/channels";
import { resolveConfig, type PartialConfig } from "@/lib/config";
import { chargeDemoAi } from "@/lib/demo";
import { applySighting, diffSignals, isExpired, matchRule, type RuleProposal } from "./learn";

export type StoredRule = {
  id: string;
  userId: string;
  projectId: string | null;
  register: string | null;
  kind: string;
  rule: string;
  pattern: string | null;
  sightings: number;
  active: boolean;
  lastSeenAt: Date;
  sourceDraftId: string | null;
};

export type LearnDraft = {
  id: string;
  userId: string;
  projectId: string;
  variants: Record<string, string>;
  finalText: Record<string, string> | null;
  userDefaults: Record<string, unknown>;
  projectConfig: Record<string, unknown>;
};

export interface LearnStore {
  loadDraft(draftId: string): Promise<LearnDraft | null>;
  listRules(userId: string): Promise<StoredRule[]>;
  getRule(id: string): Promise<StoredRule | null>;
  insertRule(row: Omit<StoredRule, "id">): Promise<string>;
  updateRule(id: string, patch: Partial<Pick<StoredRule, "sightings" | "active" | "lastSeenAt" | "register">>): Promise<void>;
  deleteRule(id: string): Promise<void>;
  /** User-level voice DNA for a register, or null when there is no profile yet. */
  getUserDna(userId: string, register: string): Promise<Record<string, unknown> | null>;
  saveUserDna(userId: string, register: string, dna: Record<string, unknown>): Promise<void>;
}

export type LearnDeps = {
  store?: LearnStore;
  callJson?: typeof realCallJson;
  /** Counts an AI call against the demo budget; throws DemoLimitError when spent. */
  chargeAi?: (userId: string) => Promise<void>;
  now?: () => Date;
};

export type LearnedRule = {
  ruleId: string;
  kind: string;
  rule: string;
  register: string | null;
  sightings: number;
  active: boolean;
};

const EXAMPLES_KEPT = 10;

const learned = (r: StoredRule): LearnedRule => ({
  ruleId: r.id,
  kind: r.kind,
  rule: r.rule,
  register: r.register,
  sightings: r.sightings,
  active: r.active,
});

function setup(deps: LearnDeps) {
  return {
    store: deps.store ?? drizzleLearnStore,
    callJson: deps.callJson ?? realCallJson,
    chargeAi: deps.chargeAi ?? ((userId: string) => chargeDemoAi(userId)),
    now: (deps.now ?? (() => new Date()))(),
  };
}

async function loadOrThrow(store: LearnStore, draftId: string) {
  const draft = await store.loadDraft(draftId);
  if (!draft) throw new Error(`Draft ${draftId} not found`);
  return { draft, config: resolveConfig(draft.userDefaults as PartialConfig, draft.projectConfig as PartialConfig) };
}

/** Live rules for a user, with stale single sightings deleted on the way. */
async function liveRules(store: LearnStore, userId: string, now: Date) {
  const rules: StoredRule[] = [];
  for (const r of await store.listRules(userId)) {
    if (isExpired(r, now)) await store.deleteRule(r.id);
    else rules.push(r);
  }
  return rules;
}

async function sight(store: LearnStore, rules: StoredRule[], existing: StoredRule | undefined, row: Omit<StoredRule, "id">, now: Date) {
  if (existing) {
    const next = applySighting(existing, existing, now);
    const patch = { sightings: next.sightings, active: row.active || next.active, lastSeenAt: now };
    await store.updateRule(existing.id, patch);
    return Object.assign(existing, patch);
  }
  const stored = { ...row, id: await store.insertRule(row) };
  rules.push(stored);
  return stored;
}

export const editedChannels = (variants: Record<string, string>, finalText: Record<string, string> | null) =>
  Object.keys(variants).filter((k) => finalText?.[k] !== undefined && finalText[k].trim() !== variants[k].trim());

export async function learnFromEdit(draftId: string, deps: LearnDeps = {}): Promise<LearnedRule[]> {
  const { store, callJson, chargeAi, now } = setup(deps);
  const { draft, config } = await loadOrThrow(store, draftId);
  const edited = editedChannels(draft.variants, draft.finalText);
  if (!edited.length) return [];

  const rules = await liveRules(store, draft.userId, now);
  const touched = new Map<string, StoredRule>();
  for (const key of edited) {
    const before = draft.variants[key];
    const after = draft.finalText![key];
    const register = registerFor(key, config);
    let proposals: RuleProposal[];
    try {
      await chargeAi(draft.userId);
      const prompt = ruleProposalPrompt({ before, after, signals: diffSignals(before, after) });
      proposals = (await callJson(RuleProposalsSchema, {
        ...prompt,
        maxTokens: 400,
        effort: "low",
        meta: { purpose: "rule-proposal", userId: draft.userId, projectId: draft.projectId, refType: "draft", refId: draft.id },
      })).data.proposals;
    } catch {
      continue;
    }
    for (const p of proposals) {
      const repeat = matchRule([...touched.values()], p) as StoredRule | undefined;
      if (repeat) {
        // Seen in two registers within one edit: it is a general rule, but still one sighting.
        if (repeat.register !== null && repeat.register !== register) {
          await store.updateRule(repeat.id, { register: null });
          repeat.register = null;
        }
        continue;
      }
      const scoped = rules.filter((r) => r.register === null || r.register === register);
      const existing = matchRule(scoped, p) as StoredRule | undefined;
      const first = applySighting(undefined, p, now);
      const stored = await sight(store, rules, existing, {
        userId: draft.userId,
        projectId: null,
        register,
        kind: p.kind,
        rule: p.rule,
        pattern: p.pattern ?? null,
        sightings: first.sightings,
        active: first.active,
        lastSeenAt: now,
        sourceDraftId: draft.id,
      }, now);
      touched.set(stored.id, stored);
    }
  }
  return [...touched.values()].map(learned);
}

/** An explicit reject reason becomes a `never` rule that is live at once; any edits are learned too. */
export async function learnFromReject(draftId: string, reason: string, deps: LearnDeps = {}): Promise<LearnedRule[]> {
  const { store, now } = setup(deps);
  const { draft } = await loadOrThrow(store, draftId);
  const rules = await liveRules(store, draft.userId, now);
  const proposal = { kind: "never", rule: reason.trim(), pattern: null };
  const stored = await sight(store, rules, matchRule(rules, proposal) as StoredRule | undefined, {
    userId: draft.userId,
    projectId: null,
    register: null,
    ...proposal,
    sightings: 1,
    active: true,
    lastSeenAt: now,
    sourceDraftId: draft.id,
  }, now);
  const fromEdit = await learnFromEdit(draftId, deps).catch(() => []);
  return [learned(stored), ...fromEdit.filter((r) => r.ruleId !== stored.id)];
}

export function pushExample(examples: unknown, text: string, keep = EXAMPLES_KEPT): string[] {
  const list = Array.isArray(examples) ? examples.filter((e): e is string => typeof e === "string" && e !== text) : [];
  return [...list, text].slice(-keep);
}

/** An unchanged approve feeds the per-register examples pool used by compose. */
export async function addExamples(draftId: string, deps: LearnDeps = {}): Promise<void> {
  const { store } = setup(deps);
  const { draft, config } = await loadOrThrow(store, draftId);
  const texts = { ...draft.variants, ...draft.finalText };
  const byRegister = new Map<string, string[]>();
  for (const [key, text] of Object.entries(texts)) {
    if (!text?.trim()) continue;
    const register = registerFor(key, config);
    byRegister.set(register, [...(byRegister.get(register) ?? []), text]);
  }
  for (const [register, list] of byRegister) {
    const dna = (await store.getUserDna(draft.userId, register)) ?? {};
    let examples = Array.isArray(dna.examples) ? (dna.examples as string[]) : [];
    for (const text of list) examples = pushExample(examples, text);
    await store.saveUserDna(draft.userId, register, { ...dna, examples });
  }
}

export async function acceptRule(userId: string, ruleId: string, deps: LearnDeps = {}): Promise<boolean> {
  const { store, now } = setup(deps);
  const rule = await store.getRule(ruleId);
  if (!rule || rule.userId !== userId) return false;
  await store.updateRule(ruleId, { active: true, lastSeenAt: now });
  return true;
}

/** Undo one sighting: a first sighting is forgotten, a repeat rolls back to its previous count. */
export async function undoRule(userId: string, ruleId: string, deps: LearnDeps = {}): Promise<boolean> {
  const { store } = setup(deps);
  const rule = await store.getRule(ruleId);
  if (!rule || rule.userId !== userId) return false;
  if (rule.sightings <= 1) await store.deleteRule(ruleId);
  else await store.updateRule(ruleId, { sightings: rule.sightings - 1, active: rule.sightings - 1 >= 2 });
  return true;
}

export const drizzleLearnStore: LearnStore = {
  async loadDraft(draftId) {
    const [row] = await db
      .select({ draft: drafts, project: projects, user: users })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(drafts.id, draftId));
    if (!row) return null;
    return {
      id: row.draft.id,
      userId: row.user.id,
      projectId: row.project.id,
      variants: row.draft.variants,
      finalText: row.draft.finalText,
      userDefaults: row.user.defaults,
      projectConfig: row.project.config,
    };
  },
  listRules: (userId) => db.select().from(voiceRules).where(eq(voiceRules.userId, userId)),
  async getRule(id) {
    const [row] = await db.select().from(voiceRules).where(eq(voiceRules.id, id));
    return row ?? null;
  },
  async insertRule(row) {
    const [r] = await db.insert(voiceRules).values(row).returning({ id: voiceRules.id });
    return r.id;
  },
  async updateRule(id, patch) {
    await db.update(voiceRules).set(patch).where(eq(voiceRules.id, id));
  },
  async deleteRule(id) {
    await db.delete(voiceRules).where(eq(voiceRules.id, id));
  },
  async getUserDna(userId, register) {
    const [row] = await db
      .select({ dna: voiceProfiles.dna })
      .from(voiceProfiles)
      .where(and(eq(voiceProfiles.userId, userId), isNull(voiceProfiles.projectId), eq(voiceProfiles.register, register)));
    return row?.dna ?? null;
  },
  async saveUserDna(userId, register, dna) {
    const where = and(eq(voiceProfiles.userId, userId), isNull(voiceProfiles.projectId), eq(voiceProfiles.register, register));
    const updated = await db.update(voiceProfiles).set({ dna }).where(where).returning({ id: voiceProfiles.id });
    if (!updated.length) await db.insert(voiceProfiles).values({ userId, register, dna });
  },
};
