import { describe, it, expect, vi } from "vitest";
import {
  DEMO_AI_LIMIT,
  DemoLimitError,
  buildDemoSeed,
  chargeDemoAi,
  cleanupOldDemos,
  createDemoUser,
  createRateLimiter,
  displayRepo,
  isDemoUser,
  withDemoBudget,
  type DemoSeed,
  type DemoStore,
} from "@/lib/demo";

const NOW = new Date("2026-11-10T12:00:00Z");
const HOUR = 3_600_000;

function fakeStore() {
  const seeds: DemoSeed[] = [];
  const sessions = new Map<string, { createdAt: Date; aiCalls: number }>();
  const store: DemoStore = {
    async insertSeed(seed) {
      seeds.push(seed);
      sessions.set(seed.session.id, { createdAt: seed.session.createdAt, aiCalls: 0 });
    },
    async sessionIdForUser(userId) {
      const seed = seeds.find((s) => s.user.id === userId);
      return seed && sessions.has(seed.session.id) ? seed.session.id : null;
    },
    async incrementAiCalls(sessionId) {
      const s = sessions.get(sessionId)!;
      return ++s.aiCalls;
    },
    async expiredSessions(before) {
      return [...sessions].filter(([, s]) => s.createdAt < before).map(([id]) => id);
    },
    async deleteSessions(ids) {
      ids.forEach((id) => sessions.delete(id));
    },
  };
  let n = 0;
  const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  return { store, seeds, sessions, deps: { store, newId, now: () => NOW } };
}

describe("buildDemoSeed", () => {
  const seed = buildDemoSeed("abcdef12-0000-4000-8000-000000000000", NOW, () => crypto.randomUUID());

  it("creates a synthetic demo user with simulated channels", () => {
    expect(seed.user.bufferAccountId).toBe("demo:abcdef12-0000-4000-8000-000000000000");
    expect(seed.user.timezone).toBe("Asia/Kolkata");
    expect(seed.user.channels?.map((c) => [c.id, c.service])).toEqual([["linkedin", "linkedin"], ["x", "twitter"]]);
    expect(seed.session.id).toBe("abcdef12-0000-4000-8000-000000000000");
  });

  it("creates a demo project scoped to a demo-only repo name", () => {
    expect(seed.project.isDemo).toBe(true);
    expect(seed.project.userId).toBe(seed.user.id);
    expect(seed.project.config).toMatchObject({ channels: ["linkedin", "x"] });
    expect(seed.repo).toMatchObject({ projectId: seed.project.id, installationId: 0 });
    expect(seed.repo.repoFullName).toBe("krushiraj/shiplog#demo-abcdef12");
    expect(displayRepo(seed.repo.repoFullName)).toBe("krushiraj/shiplog");
  });

  it("seeds processed events with one change card each, spread over the last two days", () => {
    expect(seed.events.length).toBeGreaterThanOrEqual(10);
    expect(seed.cards).toHaveLength(seed.events.length);
    for (const e of seed.events) {
      expect(e.processedAt).toBeInstanceOf(Date);
      expect(e.repoFullName).toBe(seed.repo.repoFullName);
    }
    const eventIds = new Set(seed.events.map((e) => e.id));
    for (const c of seed.cards) {
      expect(eventIds.has(c.eventId)).toBe(true);
      expect(c.occurredAt.getTime()).toBeLessThanOrEqual(NOW.getTime());
      expect(c.occurredAt.getTime()).toBeGreaterThanOrEqual(NOW.getTime() - 48 * HOUR);
    }
    expect(seed.cards.filter((c) => c.whyInferred)).toHaveLength(2);
    expect(seed.cards.filter((c) => c.openQuestion)).toHaveLength(1);
  });

  it("seeds a user-level voice, one active and one pending rule, and two pending drafts", () => {
    expect(seed.profiles.map((p) => p.register).sort()).toEqual(["linkedin", "x-short"]);
    expect(seed.profiles.every((p) => p.projectId === null && p.userId === seed.user.id)).toBe(true);
    expect(seed.rules.map((r) => r.active).sort()).toEqual([false, true]);

    const cardIds = new Set(seed.cards.map((c) => c.id));
    expect(seed.drafts).toHaveLength(2);
    expect(seed.drafts.map((d) => d.trigger)).toEqual(["digest", "instant:release"]);
    expect(seed.drafts[0].cardIds).toHaveLength(5);
    for (const d of seed.drafts) {
      expect(d.status).toBe("pending");
      expect(d.projectId).toBe(seed.project.id);
      expect(d.cardIds.every((id) => cardIds.has(id))).toBe(true);
      expect(Object.keys(d.variants).sort()).toEqual(["linkedin", "x"]);
      expect(d.gate).toMatchObject({ targets: [{ channelId: "linkedin", key: "linkedin" }, { channelId: "x", key: "x" }] });
    }
  });

  it("writes drafts that follow the seeded voice", () => {
    for (const d of seed.drafts) {
      expect(d.variants.x.length).toBeLessThanOrEqual(280);
      for (const text of Object.values(d.variants)) {
        expect(text.toLowerCase()).not.toMatch(/excited to announce|game-changer/);
        expect((text.match(/#\w+/g) ?? []).length).toBeLessThanOrEqual(2);
        expect((text.match(/\p{Extended_Pictographic}/gu) ?? []).length).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe("createDemoUser", () => {
  it("stores the seed and returns the new user and project", async () => {
    const { deps, seeds } = fakeStore();
    const { userId, projectId } = await createDemoUser(deps);
    expect(seeds).toHaveLength(1);
    expect(userId).toBe(seeds[0].user.id);
    expect(projectId).toBe(seeds[0].project.id);
    expect(await isDemoUser(userId, deps)).toBe(true);
    expect(await isDemoUser("someone-else", deps)).toBe(false);
  });
});

describe("demo AI budget", () => {
  it(`allows ${DEMO_AI_LIMIT} AI calls per session, then throws DemoLimitError`, async () => {
    const { deps } = fakeStore();
    const { userId } = await createDemoUser(deps);
    for (let i = 0; i < DEMO_AI_LIMIT; i++) await chargeDemoAi(userId, deps);
    await expect(chargeDemoAi(userId, deps)).rejects.toBeInstanceOf(DemoLimitError);
  });

  it("does nothing for real users", async () => {
    const { deps, store } = fakeStore();
    const spy = vi.spyOn(store, "incrementAiCalls");
    for (let i = 0; i < DEMO_AI_LIMIT + 5; i++) await chargeDemoAi("real-user", deps);
    expect(spy).not.toHaveBeenCalled();
  });

  it("withDemoBudget runs the call within budget and skips it past the limit", async () => {
    const { deps, sessions, seeds } = fakeStore();
    const { userId } = await createDemoUser(deps);
    const fn = vi.fn(async () => "ok");
    expect(await withDemoBudget(userId, fn, deps)).toBe("ok");
    sessions.get(seeds[0].session.id)!.aiCalls = DEMO_AI_LIMIT;
    await expect(withDemoBudget(userId, fn, deps)).rejects.toBeInstanceOf(DemoLimitError);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("cleanupOldDemos", () => {
  it("deletes demo sessions older than the cutoff and keeps fresh ones", async () => {
    const { deps, sessions } = fakeStore();
    const { userId: old } = await createDemoUser({ ...deps, now: () => new Date(NOW.getTime() - 25 * HOUR) });
    const { userId: fresh } = await createDemoUser({ ...deps, now: () => new Date(NOW.getTime() - 2 * HOUR) });

    expect(await cleanupOldDemos(24, deps)).toBe(1);
    expect(sessions.size).toBe(1);
    expect(await isDemoUser(old, deps)).toBe(false);
    expect(await isDemoUser(fresh, deps)).toBe(true);
  });
});

describe("createRateLimiter", () => {
  it("allows max hits per key per window", () => {
    let t = 0;
    const allow = createRateLimiter(2, HOUR, () => t);
    expect([allow("ip1"), allow("ip1"), allow("ip1"), allow("ip2")]).toEqual([true, true, false, true]);
    t = HOUR + 1;
    expect(allow("ip1")).toBe(true);
  });
});
