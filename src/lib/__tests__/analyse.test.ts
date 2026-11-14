import { describe, it, expect, vi } from "vitest";
import { analyseEvent, analyseEvents, fallbackCard, milestoneLine, withMilestone, type AnalyseDeps, type AnalyseStore, type CardRow, type StoredEvent } from "@/lib/analyse";
import type { GitHub } from "@/lib/github/app";
import type { PartialConfig } from "@/lib/config";

const PATCH = "@@ -1,2 +1,3 @@\n+export const scoreWeight = 0.42;";
const AI_CARD = {
  what: "Scores now weigh recent activity higher.",
  why: "Old activity drowned out new work.",
  why_inferred: false,
  how: "Added a decay weight.",
  impact: "Fresher rankings.",
  significance: 2,
  open_question: null,
};

type Memory = {
  events: StoredEvent[];
  cards: (CardRow & { cancelled?: boolean })[];
  processed: string[];
  projectConfig: PartialConfig;
};

function memoryStore(m: Memory): AnalyseStore {
  return {
    getEvent: async (id) => m.events.find((e) => e.id === id) ?? null,
    projectsForRepo: async () => [
      { installationId: 1, userDefaults: {}, projectConfig: m.projectConfig, overrides: {}, brief: null, projectId: "p1", projectName: "App", userId: "u1", isDemo: false },
    ],
    findPrForCommit: async (repo, sha, prNumber) => {
      const pr = m.events.find(
        (e) =>
          e.repoFullName === repo &&
          e.kind === "pr_merged" &&
          (e.payload.mergeSha === sha || (prNumber != null && e.ref === String(prNumber))),
      );
      if (!pr) return null;
      return { hasCard: m.cards.some((c) => c.eventId === pr.id) };
    },
    insertCard: async (c) => void m.cards.push(c),
    cancelCommitCard: async (repo, sha) => {
      const target = m.events.find((e) => e.repoFullName === repo && e.kind === "commit" && e.ref.startsWith(sha));
      const card = target && m.cards.find((c) => c.eventId === target.id);
      if (card) card.cancelled = true;
      return !!card;
    },
    markProcessed: async (id) => void m.processed.push(id),
  };
}

function fakeGitHub() {
  const getCommit = vi.fn(async () => ({
    data: {
      commit: { message: "feat: decay weights" },
      files: [
        { filename: "src/score.ts", status: "modified", patch: PATCH, additions: 1, deletions: 0 },
        { filename: "yarn.lock", status: "modified", patch: "lock noise", additions: 300, deletions: 200 },
      ],
    },
  }));
  return { rest: { repos: { getCommit } } } as unknown as GitHub;
}

function commitEvent(over: Partial<StoredEvent> = {}): StoredEvent {
  return {
    id: "e1",
    repoFullName: "octo/app",
    kind: "commit",
    ref: "abc1234def",
    payload: { message: "feat: decay weights\n\nlonger body", installationId: 1 },
    occurredAt: new Date("2026-11-08T10:00:00Z"),
    processedAt: null,
    ...over,
  };
}

function setup(m: Partial<Memory> = {}, callJson?: AnalyseDeps["callJson"]) {
  const mem: Memory = { events: [commitEvent()], cards: [], processed: [], projectConfig: {}, ...m };
  const ai = vi.fn(callJson ?? (async () => ({ data: AI_CARD, usage: {} as never })));
  const deps: AnalyseDeps = { store: memoryStore(mem), github: async () => fakeGitHub(), callJson: ai as AnalyseDeps["callJson"] };
  return { mem, ai, deps };
}

const promptText = (ai: ReturnType<typeof vi.fn>) => {
  const args = ai.mock.calls[0][1] as { system: string; user: string };
  return args.system + args.user;
};

describe("analyseEvent", () => {
  it("inserts a card from the AI output with budgeted diffs and marks the event processed", async () => {
    const { mem, ai, deps } = setup();
    await analyseEvent("e1", deps);
    expect(mem.cards).toHaveLength(1);
    expect(mem.cards[0]).toMatchObject({
      eventId: "e1",
      repoFullName: "octo/app",
      what: AI_CARD.what,
      why: AI_CARD.why,
      whyInferred: false,
      significance: 2,
      openQuestion: null,
    });
    const text = promptText(ai);
    expect(text).toContain("scoreWeight");
    expect(text).not.toContain("lock noise");
    expect(mem.processed).toEqual(["e1"]);
  });

  it("tags the AI call with the analyse purpose, the event and the owning project", async () => {
    const { ai, deps } = setup();
    await analyseEvent("e1", deps);
    expect(ai.mock.calls[0][1]).toMatchObject({
      meta: { purpose: "analyse", refType: "event", refId: "e1", userId: "u1", projectId: "p1", projectName: "App", isDemo: false },
    });
  });

  it("sends metadata only when read_diffs is false", async () => {
    const { ai, deps } = setup({ projectConfig: { ai: { read_diffs: false } } });
    await analyseEvent("e1", deps);
    const text = promptText(ai);
    expect(text).toContain("src/score.ts");
    expect(text).not.toContain("scoreWeight");
    expect(text).not.toContain("@@");
  });

  it("scrubs secrets in messages before they reach the model", async () => {
    const { ai, deps } = setup({
      events: [commitEvent({ payload: { message: "fix: rotate ghp_1234567890abcdefghijklmnopqrstuvwxyzAB", installationId: 1 } })],
    });
    await analyseEvent("e1", deps);
    const text = promptText(ai);
    expect(text).not.toContain("ghp_1234567890");
    expect(text).toContain("[REDACTED]");
  });

  it("a revert cancels the reverted commit's card and adds none of its own", async () => {
    const target = commitEvent({ id: "e0", ref: "deadbeef1234567" });
    const revert = commitEvent({
      id: "e2",
      kind: "revert",
      ref: "fff000",
      payload: { message: 'Revert "feat"', revertsSha: "deadbeef", installationId: 1 },
    });
    const { mem, ai, deps } = setup({
      events: [target, revert],
      cards: [{ eventId: "e0", repoFullName: "octo/app", what: "x", why: null, whyInferred: true, how: null, impact: null, significance: 2, openQuestion: null, occurredAt: new Date() }],
    });
    await analyseEvent("e2", deps);
    expect(mem.cards).toHaveLength(1);
    expect(mem.cards[0].cancelled).toBe(true);
    expect(ai).not.toHaveBeenCalled();
    expect(mem.processed).toEqual(["e2"]);
  });

  it("falls back to a metadata card when the AI fails", async () => {
    const { mem, deps } = setup(
      { events: [commitEvent({ payload: { message: "docs: fix typo\n\nbody", installationId: 1 } })] },
      async () => {
        throw new Error("boom");
      },
    );
    await analyseEvent("e1", deps);
    expect(mem.cards[0]).toMatchObject({ what: "docs: fix typo", significance: 0, whyInferred: true, why: null });
    expect(mem.processed).toEqual(["e1"]);
  });

  it("skips a commit already covered by a carded merged PR", async () => {
    const pr = commitEvent({ id: "p1", kind: "pr_merged", ref: "12", payload: { title: "Decay", mergeSha: "abc1234def" } });
    const { mem, ai, deps } = setup({
      events: [commitEvent(), pr],
      cards: [{ eventId: "p1", repoFullName: "octo/app", what: "PR", why: null, whyInferred: true, how: null, impact: null, significance: 2, openQuestion: null, occurredAt: new Date() }],
    });
    await analyseEvent("e1", deps);
    expect(mem.cards).toHaveLength(1);
    expect(ai).not.toHaveBeenCalled();
    expect(mem.processed).toEqual(["e1"]);
  });

  it("gives a PR's squash commit significance 0 when the PR card does not exist yet", async () => {
    const { mem, deps } = setup({
      events: [commitEvent({ payload: { message: "feat: decay (#12)", prNumber: 12, installationId: 1 } })],
    });
    await analyseEvent("e1", deps);
    expect(mem.cards[0].significance).toBe(0);
  });

  it("does nothing for an already processed event", async () => {
    const { mem, ai, deps } = setup({ events: [commitEvent({ processedAt: new Date() })] });
    await analyseEvent("e1", deps);
    expect(ai).not.toHaveBeenCalled();
    expect(mem.cards).toHaveLength(0);
  });
});

describe("fallbackCard", () => {
  it.each([
    ["release", { name: "v1.0" }, 3],
    ["tag", {}, 3],
    ["pr_merged", { title: "Add export" }, 2],
    ["pr_merged", { title: "chore(deps): bump x" }, 0],
    ["commit", { message: "fix: crash" }, 1],
    ["commit", { message: "deps: bump zod" }, 0],
  ])("%s %o → significance %i", (kind, payload, sig) => {
    expect(fallbackCard({ ...commitEvent(), kind, payload }).significance).toBe(sig);
  });
});

describe("analyseEvents", () => {
  it("runs sequentially, caps at 20 and survives a failing event", async () => {
    const order: string[] = [];
    const ids = Array.from({ length: 25 }, (_, i) => `e${i}`);
    const run = vi.fn(async (id: string) => {
      order.push(id);
      if (id === "e3") throw new Error("bad");
    });
    await analyseEvents(ids, undefined, run);
    expect(order).toEqual(ids.slice(0, 20));
  });
});

describe("milestones", () => {
  it("adds a dated milestone to the project brief for a significant card", async () => {
    const { deps } = setup();
    const appendMilestone = vi.fn(async () => {});
    deps.store.appendMilestone = appendMilestone;
    await analyseEvent("e1", deps);
    expect(appendMilestone).toHaveBeenCalledWith("p1", `2026-11-08: ${AI_CARD.what}`);
  });

  it("skips minor cards and survives a failing write", async () => {
    const minor = setup(undefined, (async () => ({ data: { ...AI_CARD, significance: 1 }, usage: {} as never })) as unknown as AnalyseDeps["callJson"]);
    const append = vi.fn(async () => {});
    minor.deps.store.appendMilestone = append;
    await analyseEvent("e1", minor.deps);
    expect(append).not.toHaveBeenCalled();

    const failing = setup();
    failing.deps.store.appendMilestone = async () => {
      throw new Error("db down");
    };
    await analyseEvent("e1", failing.deps);
    expect(failing.mem.cards).toHaveLength(1);
    expect(failing.mem.processed).toEqual(["e1"]);
  });

  it("keeps the newest 20, skips duplicates and ignores bad data", () => {
    const many = Array.from({ length: 20 }, (_, i) => `m${i}`);
    expect(withMilestone(many, "new")).toEqual([...many.slice(1), "new"]);
    expect(withMilestone(["a"], "a")).toEqual(["a"]);
    expect(withMilestone(null, "a")).toEqual(["a"]);
    expect(withMilestone(["a", 3], "b")).toEqual(["a", "b"]);
  });

  it("shortens long lines", () => {
    const line = milestoneLine({ what: "x".repeat(300), occurredAt: new Date("2026-11-14T01:00:00Z") });
    expect(line.startsWith("2026-11-14: ")).toBe(true);
    expect(line.length).toBeLessThanOrEqual(12 + 160);
  });
});
