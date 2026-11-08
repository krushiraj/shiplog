import { describe, expect, it } from "vitest";
import { budgetFor, loadUsage, summariseUsage, type UsageRow, type UsageSource } from "../usage";

const NOW = new Date("2026-11-08T15:00:00Z");
const DAY = 86_400_000;

let n = 0;
function row(over: Partial<UsageRow> = {}): UsageRow {
  return {
    id: `r${++n}`,
    createdAt: NOW,
    purpose: "compose",
    model: "claude-sonnet-5-5",
    projectId: "p1",
    projectName: "Shiplog",
    refType: "draft",
    refId: "d1",
    estInputTokens: 1000,
    estOutputTokens: 500,
    estCostUsd: 0.01,
    inputTokens: 800,
    outputTokens: 400,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: 0.008,
    cacheSavingsUsd: 0,
    latencyMs: 1200,
    attempts: 1,
    status: "ok",
    errorMessage: null,
    ...over,
  };
}

const rows: UsageRow[] = [
  row({ costUsd: 0.1, estCostUsd: 0.08 }),
  row({ createdAt: new Date(NOW.getTime() - 3 * DAY), purpose: "analyse", refType: "event", refId: "e1", costUsd: 0.02, estCostUsd: 0.04, cacheReadTokens: 200, cacheSavingsUsd: 0.0004 }),
  row({ createdAt: new Date(NOW.getTime() - 3 * DAY), purpose: "analyse", refType: "event", refId: "e2", costUsd: 0.04, estCostUsd: 0.04, projectId: "p2", projectName: "Other" }),
  row({ createdAt: new Date(NOW.getTime() - 20 * DAY), purpose: "voice-check", costUsd: 0.06, estCostUsd: 0.03 }),
  row({ createdAt: new Date(NOW.getTime() - 60 * DAY), purpose: "compose", costUsd: 0.2, estCostUsd: 0.2 }),
  row({ purpose: "compose", status: "skipped_budget", attempts: 0, costUsd: 0, inputTokens: 0, outputTokens: 0, estCostUsd: 0.5 }),
];

describe("summariseUsage", () => {
  const s = summariseUsage(rows, { postedDrafts: 2, isDemo: false, now: NOW });

  it("totals cost, tokens and calls per window", () => {
    expect(s.windows.today).toMatchObject({ calls: 2, costUsd: 0.1, inputTokens: 800, outputTokens: 400 });
    expect(s.windows.d7.calls).toBe(4);
    expect(s.windows.d7.costUsd).toBeCloseTo(0.16);
    expect(s.windows.d30.costUsd).toBeCloseTo(0.22);
    expect(s.windows.all.costUsd).toBeCloseTo(0.42);
    expect(s.windows.all).toMatchObject({ calls: 6, cacheReadTokens: 200, skipped: 1 });
    expect(s.windows.all.cacheSavingsUsd).toBeCloseTo(0.0004);
  });

  it("breaks spend down by purpose with estimate accuracy over calls that ran", () => {
    const compose = s.byPurpose.find((p) => p.purpose === "compose")!;
    expect(compose.calls).toBe(3);
    expect(compose.costUsd).toBeCloseTo(0.3);
    expect(compose.accuracy).toBeCloseTo(0.3 / 0.28);
    const analyse = s.byPurpose.find((p) => p.purpose === "analyse")!;
    expect(analyse.accuracy).toBeCloseTo(0.06 / 0.08);
    expect(s.byPurpose[0].purpose).toBe("compose");
  });

  it("breaks spend down by project", () => {
    expect(s.byProject.map((p) => [p.projectName, Number(p.costUsd.toFixed(4))])).toEqual([
      ["Shiplog", 0.38],
      ["Other", 0.04],
    ]);
  });

  it("computes cache hit ratio and unit costs", () => {
    expect(s.cacheHitRatio).toBeCloseTo(200 / (800 * 5 + 200));
    expect(s.costPerCard).toBeCloseTo(0.03);
    expect(s.costPerPostedDraft).toBeCloseTo((0.1 + 0.06 + 0.2) / 2);
  });

  it("reports today's budget and the most recent calls first", () => {
    expect(s.budget).toEqual({ limitUsd: 1, spentUsd: 0.1, remainingUsd: 0.9, scope: "today" });
    expect(s.recent[0].createdAt.getTime()).toBeGreaterThanOrEqual(s.recent[1].createdAt.getTime());
    expect(s.recent.at(-1)!.createdAt.getTime()).toBe(NOW.getTime() - 60 * DAY);
  });

  it("uses the session allowance for demo users", () => {
    const demo = summariseUsage(rows, { postedDrafts: 0, isDemo: true, now: NOW });
    expect(demo.budget.scope).toBe("demo");
    expect(demo.budget.limitUsd).toBe(0.25);
    expect(demo.budget.remainingUsd).toBe(0);
    expect(demo.costPerPostedDraft).toBeNull();
  });

  it("handles no usage", () => {
    const empty = summariseUsage([], { postedDrafts: 0, isDemo: false, now: NOW });
    expect(empty.windows.all.calls).toBe(0);
    expect(empty.cacheHitRatio).toBeNull();
    expect(empty.costPerCard).toBeNull();
    expect(empty.budget.remainingUsd).toBe(1);
  });
});

describe("loadUsage", () => {
  it("reads from the source", async () => {
    const source: UsageSource = { rows: async () => rows, postedDrafts: async () => 4, isDemo: async () => false };
    const s = await loadUsage("u1", { source, now: () => NOW });
    expect(s.windows.all.calls).toBe(6);
    expect(s.costPerPostedDraft).toBeCloseTo(0.36 / 4);
  });
});

describe("budgetFor", () => {
  it("reports today's spend for real users and the session spend for demo users", async () => {
    const store = (snap: { today: number; total: number; isDemo: boolean }) => ({ snapshot: async () => snap });
    expect(await budgetFor("u1", { store: store({ today: 0.12, total: 3, isDemo: false }) })).toEqual({ limitUsd: 1, spentUsd: 0.12, remainingUsd: 0.88, scope: "today" });
    expect(await budgetFor("u1", { store: store({ today: 0.05, total: 0.2, isDemo: true }) })).toEqual({ limitUsd: 0.25, spentUsd: 0.2, remainingUsd: 0.05, scope: "demo" });
  });
});
