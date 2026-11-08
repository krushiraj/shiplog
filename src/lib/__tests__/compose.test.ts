import { describe, it, expect, vi } from "vitest";
import { compose, type ComposeContext, type ComposeStore, type NewDraft } from "@/lib/compose";
import { resolveTargets } from "@/lib/channels";
import { DEFAULTS } from "@/lib/config";
import type { CachedChannel } from "@/db/schema";

const channel = (id: string, service: string, over: Partial<CachedChannel> = {}): CachedChannel => ({
  id, name: id, displayName: null, service, avatar: "", isDisconnected: false, isLocked: false,
  isQueuePaused: false, timezone: null, type: null, descriptor: null, ...over,
});

const card = (id: string, what: string, significance: number) => ({
  id, repoFullName: "kr/shiplog", what, why: "because", how: null, impact: null, significance, answer: null,
});

function makeContext(over: Partial<ComposeContext> = {}): ComposeContext {
  return {
    project: { id: "p1", name: "Shiplog", userId: "u1", isDemo: false },
    userDefaults: {},
    projectConfig: { channels: ["ch_x", "ch_li"] },
    brief: null,
    cards: [card("c1", "Added a digest scheduler", 2), card("c2", "Fixed login redirect", 1), card("c3", "Bumped deps", 0)],
    channels: [channel("ch_x", "twitter"), channel("ch_li", "linkedin")],
    voiceProfiles: [
      { projectId: null, register: "x-short", dna: { tone: "user-level" } },
      { projectId: "p1", register: "x-short", dna: { tone: "project-level" } },
    ],
    rules: [{ kind: "never", rule: "synergy", pattern: null, register: null }],
    recentPosts: ["old post"],
    ...over,
  };
}

function makeStore(ctx = makeContext()) {
  const inserted: NewDraft[] = [];
  const store: ComposeStore = {
    load: vi.fn(async () => ctx),
    insertDraft: vi.fn(async (d: NewDraft) => {
      inserted.push(d);
      return "d1";
    }),
  };
  return { store, inserted };
}

const usage = { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0 };

describe("resolveTargets", () => {
  it("maps Buffer services to channel keys, registers and limits", () => {
    const targets = resolveTargets(["ch_x", "ch_li", "missing"], [channel("ch_x", "twitter"), channel("ch_li", "linkedin")], DEFAULTS);
    expect(targets).toEqual([
      expect.objectContaining({ channelId: "ch_x", key: "x", register: "x-short", limit: 280 }),
      expect.objectContaining({ channelId: "ch_li", key: "linkedin", register: "linkedin", limit: 3000 }),
    ]);
  });
});

describe("compose", () => {
  it("gates every variant, runs a voice check and stores a pending draft", async () => {
    const { store, inserted } = makeStore();
    const callJson = vi
      .fn()
      .mockResolvedValueOnce({
        data: { variants: { x: "Shipped a scheduler — it runs every evening.", linkedin: "Real synergy in this release." }, themes: ["scheduling"] },
        usage,
      })
      .mockResolvedValueOnce({ data: { scores: { x: 0.1, linkedin: 0.3 }, suggestions: { x: [], linkedin: ["shorter"] } }, usage });

    const res = await compose("p1", ["c1", "c2", "c3"], "digest", {}, { store, callJson });

    expect(res.draftId).toBe("d1");
    expect(res.variants.x).not.toContain("—");
    expect(res.gate.x.fixed).toContain("replaced em/en dashes");
    expect(res.gate.linkedin.violations.map((v) => v.kind)).toContain("never");
    expect(res.voiceScore.x).toBeCloseTo(0.9);
    expect(res.voiceScore.linkedin).toBeCloseTo(0.7);
    expect(res.suggestions.linkedin).toEqual(["shorter"]);

    const composeArgs = callJson.mock.calls[0][1] as { system: string };
    expect(composeArgs.system).toContain("project-level");
    expect(composeArgs.system).not.toContain("user-level");

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ projectId: "p1", trigger: "digest", cardIds: ["c1", "c2", "c3"], status: "pending" });
    expect(inserted[0].gate).toMatchObject({ fallback: false, targets: [{ channelId: "ch_x", key: "x" }, { channelId: "ch_li", key: "linkedin" }] });
    expect((inserted[0].gate.usage as { inputTokens: number }).inputTokens).toBe(20);
  });

  it("falls back to a template per channel when the AI fails", async () => {
    const { store, inserted } = makeStore();
    const callJson = vi.fn().mockRejectedValue(new Error("boom"));

    const res = await compose("p1", ["c1", "c2", "c3"], "digest", {}, { store, callJson });

    expect(callJson).toHaveBeenCalledTimes(1);
    expect(res.variants.x).toMatch(/^Today in Shiplog:/);
    expect(res.variants.linkedin).toContain("• Added a digest scheduler");
    expect(res.variants.x.length).toBeLessThanOrEqual(280);
    expect(res.voiceScore).toEqual({});
    expect(inserted[0].gate.fallback).toBe(true);
  });

  it("fills a channel the model skipped with the fallback and passes the nudge", async () => {
    const { store } = makeStore();
    const callJson = vi
      .fn()
      .mockResolvedValueOnce({ data: { variants: { x: "Short and sweet" }, themes: [] }, usage })
      .mockResolvedValueOnce({ data: { scores: { x: 0, linkedin: 0 }, suggestions: {} }, usage });

    const res = await compose("p1", ["c1"], "digest", { nudge: "mention the cron" }, { store, callJson });

    expect(res.variants.linkedin).toMatch(/^Today in Shiplog:/);
    expect((callJson.mock.calls[0][1] as { user: string }).user).toContain("mention the cron");
  });
});
