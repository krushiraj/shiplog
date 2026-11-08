import { describe, expect, it, vi } from "vitest";
import {
  acceptRule,
  addExamples,
  learnFromEdit,
  learnFromReject,
  pushExample,
  undoRule,
  type LearnDraft,
  type LearnStore,
  type StoredRule,
} from "@/lib/voice/learn-server";

const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0 };
const NOW = new Date("2026-11-11T10:00:00Z");

function makeStore(over: { draft?: Partial<LearnDraft>; rules?: StoredRule[]; profiles?: Record<string, Record<string, unknown>> } = {}) {
  const rules: StoredRule[] = [...(over.rules ?? [])];
  const profiles: Record<string, Record<string, unknown>> = { ...(over.profiles ?? {}) };
  const draft: LearnDraft = {
    id: "d1",
    userId: "u1",
    projectId: "p1",
    variants: { x: "Super excited to share that we shipped scoring! 🚀", linkedin: "We shipped scoring." },
    finalText: { x: "Shipped scoring." },
    userDefaults: {},
    projectConfig: {},
    ...over.draft,
  };
  let next = 1;
  const store: LearnStore = {
    loadDraft: vi.fn(async (id: string) => (id === draft.id ? draft : null)),
    listRules: vi.fn(async (userId: string) => rules.filter((r) => r.userId === userId)),
    getRule: vi.fn(async (id: string) => rules.find((r) => r.id === id) ?? null),
    insertRule: vi.fn(async (row) => {
      const id = `r${next++}`;
      rules.push({ ...row, id });
      return id;
    }),
    updateRule: vi.fn(async (id, patch) => {
      Object.assign(rules.find((r) => r.id === id)!, patch);
    }),
    deleteRule: vi.fn(async (id) => {
      rules.splice(rules.findIndex((r) => r.id === id), 1);
    }),
    getUserDna: vi.fn(async (_userId, register) => profiles[register] ?? null),
    saveUserDna: vi.fn(async (_userId, register, dna) => {
      profiles[register] = dna;
    }),
  };
  return { store, rules, profiles };
}

const rule = (over: Partial<StoredRule>): StoredRule => ({
  id: "r0",
  userId: "u1",
  projectId: null,
  register: null,
  kind: "never",
  rule: "super excited",
  pattern: null,
  sightings: 1,
  active: false,
  lastSeenAt: new Date("2026-11-10"),
  sourceDraftId: null,
  ...over,
});

const chargeAi = async () => {};

const proposing = (proposals: { kind: string; rule: string; pattern: string | null }[]) =>
  vi.fn().mockResolvedValue({ data: { proposals }, usage });

describe("learnFromEdit", () => {
  it("proposes rules only for edited channels and stores them inactive on first sighting", async () => {
    const { store, rules } = makeStore();
    const callJson = proposing([{ kind: "never", rule: "Super excited", pattern: "super excited" }]);

    const learned = await learnFromEdit("d1", { store, callJson, chargeAi, now: () => NOW });

    expect(callJson).toHaveBeenCalledTimes(1);
    const prompt = callJson.mock.calls[0][1] as { user: string };
    expect(prompt.user).toContain("Super excited to share");
    expect(learned).toEqual([expect.objectContaining({ kind: "never", rule: "Super excited", active: false, sightings: 1, register: "x-short" })]);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ sourceDraftId: "d1", userId: "u1", active: false });
    expect(learned[0].ruleId).toBe(rules[0].id);
  });

  it("activates a matching existing rule on its second sighting", async () => {
    const { store, rules } = makeStore({ rules: [rule({ id: "r0" })] });
    const learned = await learnFromEdit("d1", { store, chargeAi, callJson: proposing([{ kind: "never", rule: "super excited!", pattern: null }]), now: () => NOW });

    expect(learned).toEqual([expect.objectContaining({ ruleId: "r0", active: true, sightings: 2 })]);
    expect(rules[0]).toMatchObject({ active: true, sightings: 2, lastSeenAt: NOW });
  });

  it("counts one sighting per draft even when several channels propose the same rule", async () => {
    const { store, rules } = makeStore({
      draft: { finalText: { x: "Shipped scoring.", linkedin: "Shipped scoring for real." } },
      rules: [],
    });
    const learned = await learnFromEdit("d1", { store, chargeAi, callJson: proposing([{ kind: "never", rule: "super excited", pattern: null }]), now: () => NOW });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ sightings: 1, register: null });
    expect(learned).toEqual([expect.objectContaining({ register: null })]);
  });

  it("does nothing when the text was not edited", async () => {
    const { store } = makeStore({ draft: { finalText: { x: "Super excited to share that we shipped scoring! 🚀" } } });
    const callJson = proposing([]);
    expect(await learnFromEdit("d1", { store, callJson, chargeAi })).toEqual([]);
    expect(callJson).not.toHaveBeenCalled();
  });

  it("skips learning once the demo AI budget is spent", async () => {
    const { store } = makeStore();
    const callJson = proposing([{ kind: "never", rule: "x", pattern: null }]);
    const spent = async () => {
      throw new Error("demo limit");
    };
    expect(await learnFromEdit("d1", { store, callJson, chargeAi: spent })).toEqual([]);
    expect(callJson).not.toHaveBeenCalled();
  });

  it("survives a failing model call", async () => {
    const { store } = makeStore();
    const callJson = vi.fn().mockRejectedValue(new Error("boom"));
    expect(await learnFromEdit("d1", { store, callJson, chargeAi })).toEqual([]);
  });

  it("drops expired single sightings before matching", async () => {
    const stale = rule({ id: "old", lastSeenAt: new Date("2026-09-01") });
    const { store, rules } = makeStore({ rules: [stale] });
    const learned = await learnFromEdit("d1", { store, chargeAi, callJson: proposing([{ kind: "never", rule: "super excited", pattern: null }]), now: () => NOW });
    expect(rules.map((r) => r.id)).not.toContain("old");
    expect(learned[0]).toMatchObject({ sightings: 1, active: false });
  });
});

describe("learnFromReject", () => {
  it("creates an active never rule from the reason", async () => {
    const { store, rules } = makeStore({ draft: { finalText: null } });
    const learned = await learnFromReject("d1", "Too much hype", { store, chargeAi, callJson: proposing([]), now: () => NOW });
    expect(rules).toEqual([expect.objectContaining({ kind: "never", rule: "Too much hype", active: true, register: null })]);
    expect(learned[0]).toMatchObject({ rule: "Too much hype", active: true });
  });

  it("activates an existing matching rule instead of duplicating it", async () => {
    const { store, rules } = makeStore({ draft: { finalText: null }, rules: [rule({ id: "r0", rule: "too much hype" })] });
    await learnFromReject("d1", "Too much hype.", { store, chargeAi, callJson: proposing([]), now: () => NOW });
    expect(rules).toHaveLength(1);
    expect(rules[0]).toMatchObject({ active: true, sightings: 2 });
  });
});

describe("pushExample", () => {
  it("dedupes and keeps the last N", () => {
    expect(pushExample(["a", "b"], "a", 10)).toEqual(["b", "a"]);
    expect(pushExample(["a", "b", "c"], "d", 3)).toEqual(["b", "c", "d"]);
    expect(pushExample(undefined, "x", 10)).toEqual(["x"]);
  });
});

describe("addExamples", () => {
  it("adds each approved text to its register's examples pool", async () => {
    const { store, profiles } = makeStore({
      draft: { finalText: null },
      profiles: { "x-short": { tone: "dry", examples: ["old"] } },
    });
    await addExamples("d1", { store });
    expect(profiles["x-short"]).toEqual({ tone: "dry", examples: ["old", "Super excited to share that we shipped scoring! 🚀"] });
    expect(profiles.linkedin).toEqual({ examples: ["We shipped scoring."] });
  });
});

describe("acceptRule / undoRule", () => {
  it("accept activates only the owner's rule", async () => {
    const { store, rules } = makeStore({ rules: [rule({ id: "r0" })] });
    expect(await acceptRule("someone-else", "r0", { store })).toBe(false);
    expect(rules[0].active).toBe(false);
    expect(await acceptRule("u1", "r0", { store })).toBe(true);
    expect(rules[0].active).toBe(true);
  });

  it("undo deletes a first sighting and rolls back a repeat", async () => {
    const { store, rules } = makeStore({ rules: [rule({ id: "r0" }), rule({ id: "r1", rule: "delve", sightings: 2, active: true })] });
    await undoRule("u1", "r0", { store });
    await undoRule("u1", "r1", { store });
    expect(rules).toEqual([expect.objectContaining({ id: "r1", sightings: 1, active: false })]);
  });
});
