import { describe, it, expect, vi } from "vitest";
import { runTick, type TickStore, type TickCard, type TickProject } from "@/lib/tick";

const NOW = new Date("2026-11-10T18:35:00Z"); // after the default 18:30 UTC slot
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);

type FakeDraft = { id: string; projectId: string; cardIds: string[]; status: string; createdAt: Date };

const card = (id: string, significance: number, kind = "commit", over: Partial<TickCard> = {}): TickCard => ({
  id, significance, occurredAt: hoursAgo(2), cancelled: false, event: { kind, ref: id, payload: {} }, ...over,
});

function makeStore(opts: { cards?: TickCard[]; drafts?: FakeDraft[]; projectConfig?: Record<string, unknown> } = {}) {
  const project: TickProject & { claimedUntil: Date | null; paused: boolean } = {
    id: "p1",
    userDefaults: {},
    projectConfig: opts.projectConfig ?? {},
    lastDigestAt: hoursAgo(24),
    repos: ["kr/shiplog"],
    claimedUntil: null,
    paused: false,
  };
  const cards = opts.cards ?? [];
  const drafts: FakeDraft[] = opts.drafts ?? [];
  const inDraft = (c: TickCard, statuses?: string[]) =>
    drafts.some((d) => d.cardIds.includes(c.id) && (!statuses || statuses.includes(d.status)));

  const store: TickStore = {
    async claimProjects(now, until, onlyIds) {
      await Promise.resolve();
      if (onlyIds && !onlyIds.includes(project.id)) return [];
      if (project.paused || (project.claimedUntil && project.claimedUntil > now)) return [];
      project.claimedUntil = until;
      return [project.id];
    },
    loadProject: async () => project,
    instantCandidates: async (_p, _r, since) => cards.filter((c) => !c.cancelled && c.occurredAt >= since && !inDraft(c)),
    digestCandidates: async (_p, _r, statuses) => cards.filter((c) => !c.cancelled && !inDraft(c, statuses)),
    setLastDigestAt: async (_p, at) => {
      project.lastDigestAt = at;
    },
    expireDrafts: async (projectId, before) => {
      const stale = drafts.filter((d) => d.projectId === projectId && d.status === "pending" && d.createdAt < before);
      stale.forEach((d) => (d.status = "expired"));
      return stale.length;
    },
  };

  let n = 0;
  const compose = vi.fn(async (projectId: string, cardIds: string[]) => {
    const id = `d${++n}`;
    drafts.push({ id, projectId, cardIds, status: "pending", createdAt: NOW });
    return { draftId: id };
  });
  const autoPublish = vi.fn(async () => {});
  const analyse = vi.fn(async () => {});
  const deps = { store, compose, autoPublish, analyse, now: () => NOW };
  return { project, drafts, deps, compose, autoPublish, analyse };
}

describe("runTick", () => {
  it("reports today's total AI cost from midnight UTC", async () => {
    const { deps } = makeStore({ cards: [] });
    const aiCostSince = vi.fn(async () => 0.4213);
    const summary = await runTick({ ...deps, aiCostSince });
    expect(aiCostSince).toHaveBeenCalledWith(new Date(Date.UTC(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate())));
    expect(summary.aiCostTodayUsd).toBe(0.4213);
  });

  it("analyses pending events, then composes a digest and hands it to auto-publish", async () => {
    const { deps, compose, autoPublish, analyse, project } = makeStore({ cards: [card("c1", 2), card("c2", 1)] });

    await runTick(deps);

    expect(analyse).toHaveBeenCalledWith(20);
    expect(compose).toHaveBeenCalledWith("p1", ["c1", "c2"], "digest");
    expect(autoPublish).toHaveBeenCalledWith("d1");
    expect(project.lastDigestAt).toEqual(NOW);
  });

  it("ticks only the given projects", async () => {
    const { deps, compose } = makeStore({ cards: [card("c1", 3)] });

    expect((await runTick({ ...deps, projectIds: ["other"] })).claimed).toEqual([]);
    expect((await runTick({ ...deps, projectIds: [] })).claimed).toEqual([]);
    expect(compose).not.toHaveBeenCalled();

    expect((await runTick({ ...deps, projectIds: ["p1"] })).claimed).toEqual(["p1"]);
    expect(compose).toHaveBeenCalled();
  });

  it("claims a project once under concurrent ticks", async () => {
    const { deps, compose } = makeStore({ cards: [card("c1", 3, "commit")], projectConfig: { triggers: { instant: [] } } });

    await Promise.all([runTick(deps), runTick(deps)]);

    expect(compose).toHaveBeenCalledTimes(1);
  });

  it("skips the digest below the significance threshold but still marks the slot", async () => {
    const { deps, compose, project } = makeStore({ cards: [card("c1", 1), card("c2", 1)] });

    await runTick(deps);

    expect(compose).not.toHaveBeenCalled();
    expect(project.lastDigestAt).toEqual(NOW);
  });

  it("creates one instant draft per matching card and never repeats it", async () => {
    const release = card("r1", 1, "release");
    const { deps, compose, project } = makeStore({ cards: [release], projectConfig: { triggers: { digest: { every: "off" } } } });

    await runTick(deps);
    project.claimedUntil = null;
    await runTick(deps);

    expect(compose).toHaveBeenCalledTimes(1);
    expect(compose).toHaveBeenCalledWith("p1", ["r1"], "instant:release");
  });

  it("expires stale pending drafts so their cards return to the digest pool", async () => {
    const drafts: FakeDraft[] = [
      { id: "old", projectId: "p1", cardIds: ["c1"], status: "pending", createdAt: hoursAgo(49) },
      { id: "new", projectId: "p1", cardIds: ["c2"], status: "pending", createdAt: hoursAgo(1) },
    ];
    const { deps, compose } = makeStore({ cards: [card("c1", 2, "commit"), card("c3", 1)], drafts });

    await runTick(deps);

    expect(drafts.find((d) => d.id === "old")!.status).toBe("expired");
    expect(drafts.find((d) => d.id === "new")!.status).toBe("pending");
    expect(compose).toHaveBeenCalledWith("p1", ["c1", "c3"], "digest");
  });
});

describe("pickForDraftNow", () => {
  it("drops chores when there is real work, most significant and newest first", async () => {
    const { pickForDraftNow } = await import("@/lib/tick");
    const picked = pickForDraftNow([
      card("chore", 0),
      card("fix", 1, "commit", { occurredAt: hoursAgo(1) }),
      card("feat-old", 2, "commit", { occurredAt: hoursAgo(5) }),
      card("feat-new", 2, "commit", { occurredAt: hoursAgo(1) }),
      card("gone", 3, "commit", { cancelled: true }),
    ]);
    expect(picked.map((c) => c.id)).toEqual(["feat-new", "feat-old", "fix"]);
  });

  it("keeps chores when they are all there is, and caps the count", async () => {
    const { pickForDraftNow } = await import("@/lib/tick");
    expect(pickForDraftNow([card("a", 0), card("b", 0)]).map((c) => c.id)).toHaveLength(2);
    expect(pickForDraftNow(Array.from({ length: 12 }, (_, i) => card(`c${i}`, 1)), 8)).toHaveLength(8);
    expect(pickForDraftNow([])).toEqual([]);
  });
});
