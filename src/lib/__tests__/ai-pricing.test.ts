import { describe, expect, it } from "vitest";
import { MODEL } from "../ai/claude";
import { PRICES, PURPOSE_OUTPUT_RATIO, cacheSavings, costOf, estimateCall, estimateTokens, priceFor } from "../ai/pricing";

const usage = (u: Partial<{ inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }>) => ({
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  ...u,
});

describe("price table", () => {
  it.each([MODEL, "claude-haiku-5-5"])("has every rate for %s", (model) => {
    const p = priceFor(model);
    for (const k of ["input", "output", "cacheWrite5m", "cacheRead"] as const) {
      expect(Number.isFinite(p[k]), `${model}.${k}`).toBe(true);
      expect(p[k]).toBeGreaterThan(0);
    }
  });

  it("matches the published per-MTok rates", () => {
    expect(PRICES["claude-sonnet-5-5"]).toMatchObject({ input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.2 });
    expect(PRICES["claude-haiku-5-5"]).toMatchObject({ input: 0.1, output: 0.5, cacheWrite5m: 0.125, cacheRead: 0.01 });
  });

  it("fails loudly for a model with no price", () => {
    expect(() => priceFor("claude-unknown-1")).toThrow(/No price/);
  });
});

describe("costOf", () => {
  it("prices input and output per million tokens", () => {
    expect(costOf("claude-sonnet-5-5", usage({ inputTokens: 1_000_000, outputTokens: 100_000 }))).toBeCloseTo(3, 9);
  });

  it("prices cache reads and writes at their own rates", () => {
    const u = usage({ inputTokens: 1000, cacheReadTokens: 10_000, cacheWriteTokens: 4000, outputTokens: 500 });
    // 1000*2 + 10000*0.2 + 4000*2.5 + 500*10 = 2000 + 2000 + 10000 + 5000 = 19000 per MTok
    expect(costOf("claude-sonnet-5-5", u)).toBeCloseTo(0.019, 9);
  });

  it("uses Haiku's long-context rates once the prompt passes 100K tokens", () => {
    expect(costOf("claude-haiku-5-5", usage({ inputTokens: 100_000, outputTokens: 1000 }))).toBeCloseTo(0.01 + 0.0005, 9);
    expect(costOf("claude-haiku-5-5", usage({ inputTokens: 90_000, cacheReadTokens: 20_000, outputTokens: 1000 }))).toBeCloseTo(
      0.045 + 0.001 + 0.0025,
      9,
    );
  });
});

describe("cacheSavings", () => {
  it("is what cache reads saved against the full input price", () => {
    expect(cacheSavings("claude-sonnet-5-5", usage({ cacheReadTokens: 1_000_000 }))).toBeCloseTo(1.8, 9);
    expect(cacheSavings("claude-sonnet-5-5", usage({ inputTokens: 500 }))).toBe(0);
  });
});

describe("estimates", () => {
  it("estimates tokens at about four characters each", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });

  it("returns input, output and cost for a call", () => {
    const est = estimateCall({ model: "claude-sonnet-5-5", system: "s".repeat(4000), user: "u".repeat(4000), maxTokens: 1000, purpose: "analyse" });
    expect(est.estInputTokens).toBeGreaterThanOrEqual(2000);
    expect(est.estOutputTokens).toBe(Math.round(1000 * PURPOSE_OUTPUT_RATIO.analyse));
    expect(est.estOutputTokens).toBeLessThanOrEqual(1000);
    expect(est.estCostUsd).toBeCloseTo(costOf("claude-sonnet-5-5", usage({ inputTokens: est.estInputTokens, outputTokens: est.estOutputTokens })), 9);
  });

  it("has an output ratio for every purpose, never above 1", () => {
    for (const r of Object.values(PURPOSE_OUTPUT_RATIO)) {
      expect(r).toBeGreaterThan(0);
      expect(r).toBeLessThanOrEqual(1);
    }
  });
});
