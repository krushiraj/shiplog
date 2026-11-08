import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiBudgetError, DemoLimitError, type SpendSnapshot } from "../ai/budget";
import { AiFormatError, createClaude, extractJson, type ClaudeClient } from "../ai/claude";
import { costOf } from "../ai/pricing";
import type { AiUsageRecord } from "../ai/usage-log";

const Schema = z.object({ what: z.string(), significance: z.number().int().min(0).max(3) });

function fakeClient(texts: string[]) {
  const create = vi.fn(async () => {
    const text = texts.shift() ?? "";
    return {
      stop_reason: "end_turn",
      content: [{ type: "text", text }],
      usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    };
  });
  return { client: { messages: { create } } as unknown as ClaudeClient, create };
}

const args = { system: "sys", user: "usr", maxTokens: 500, meta: { purpose: "analyse" as const } };

function fakeSink() {
  const rows: AiUsageRecord[] = [];
  return { rows, sink: async (r: AiUsageRecord) => void rows.push(r) };
}

const budgetOf = (snap: Partial<SpendSnapshot>) => ({ snapshot: vi.fn(async () => ({ today: 0, total: 0, isDemo: false, ...snap })) });

describe("extractJson", () => {
  it("parses bare JSON", () => {
    expect(extractJson('{"a":1}')).toEqual({ a: 1 });
  });
  it("parses JSON inside a code fence", () => {
    expect(extractJson('Here you go:\n```json\n{"a":[1,2]}\n```\nThanks')).toEqual({ a: [1, 2] });
  });
  it("parses JSON wrapped in prose", () => {
    expect(extractJson('Sure! {"a":"x } y"} hope that helps')).toEqual({ a: "x } y" });
  });
  it("throws on no JSON", () => {
    expect(() => extractJson("nothing here")).toThrow();
  });
});

describe("callJson", () => {
  it("returns validated data and usage", async () => {
    const { client, create } = fakeClient(['{"what":"Added scoring","significance":2}']);
    const { callJson } = createClaude({ client, sink: fakeSink().sink });
    const res = await callJson(Schema, args);
    expect(res.data).toEqual({ what: "Added scoring", significance: 2 });
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const params = create.mock.calls[0][0 as never] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.max_tokens).toBe(500);
  });

  it("handles JSON in prose and code fences", async () => {
    const { client } = fakeClient(['Here is the card:\n```json\n{"what":"x","significance":0}\n```']);
    const res = await createClaude({ client, sink: fakeSink().sink }).callJson(Schema, args);
    expect(res.data.what).toBe("x");
  });

  it("marks the system prompt for caching when asked", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":0}']);
    await createClaude({ client, sink: fakeSink().sink }).callJson(Schema, { ...args, cacheSystem: true });
    const params = create.mock.calls[0][0 as never] as { system: unknown };
    expect(params.system).toEqual([
      { type: "text", text: expect.stringMatching(/^sys/), cache_control: { type: "ephemeral" } },
    ]);
  });

  it("retries once with the validation error appended, summing usage", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":7}', '{"what":"x","significance":3}']);
    const res = await createClaude({ client, sink: fakeSink().sink }).callJson(Schema, args);
    expect(res.data.significance).toBe(3);
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1][0 as never] as { messages: { role: string; content: string }[] };
    expect(retry.messages.at(-1)!.content).toMatch(/significance/);
    expect(res.usage.inputTokens).toBe(200);
    expect(res.usage.outputTokens).toBe(40);
  });

  it("throws AiFormatError after two invalid responses", async () => {
    const { client, create } = fakeClient(["not json", '{"what":5}']);
    await expect(createClaude({ client, sink: fakeSink().sink }).callJson(Schema, args)).rejects.toBeInstanceOf(AiFormatError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats a refusal as a format error after retry", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "refusal",
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 },
    }));
    const client = { messages: { create } } as unknown as ClaudeClient;
    await expect(createClaude({ client, sink: fakeSink().sink }).callJson(Schema, args)).rejects.toBeInstanceOf(AiFormatError);
  });
});

describe("callJson usage logging", () => {
  let t = 0;
  const now = () => (t += 250);

  it("logs an ok row with estimate, actual tokens, cost and latency", async () => {
    const { client } = fakeClient(['{"what":"x","significance":1}']);
    const { rows, sink } = fakeSink();
    const meta = { purpose: "analyse" as const, userId: "u1", projectId: "p1", projectName: "Shiplog", refType: "event" as const, refId: "e1" };
    await createClaude({ client, sink, budget: budgetOf({}), now }).callJson(Schema, { ...args, meta });
    expect(rows).toHaveLength(1);
    const r = rows[0];
    expect(r).toMatchObject({
      status: "ok",
      attempts: 1,
      model: "claude-sonnet-5-5",
      purpose: "analyse",
      userId: "u1",
      projectId: "p1",
      projectName: "Shiplog",
      refType: "event",
      refId: "e1",
      inputTokens: 100,
      outputTokens: 20,
      isDemo: false,
      errorMessage: null,
    });
    expect(r.latencyMs).toBe(250);
    expect(r.estInputTokens).toBeGreaterThan(0);
    expect(r.estOutputTokens).toBe(250);
    expect(r.costUsd).toBeCloseTo(costOf("claude-sonnet-5-5", { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 }), 9);
  });

  it("sends and prices the requested model", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":1}']);
    const { rows, sink } = fakeSink();
    await createClaude({ client, sink }).callJson(Schema, { ...args, model: "claude-haiku-5-5" });
    expect((create.mock.calls[0][0 as never] as { model: string }).model).toBe("claude-haiku-5-5");
    expect(rows[0].model).toBe("claude-haiku-5-5");
    expect(rows[0].costUsd).toBeCloseTo((100 * 0.1 + 20 * 0.5) / 1e6, 12);
  });

  it("logs a retried row with summed usage and two attempts", async () => {
    const { client } = fakeClient(['{"what":"x","significance":9}', '{"what":"x","significance":2}']);
    const { rows, sink } = fakeSink();
    await createClaude({ client, sink }).callJson(Schema, args);
    expect(rows[0]).toMatchObject({ status: "retried", attempts: 2, inputTokens: 200, outputTokens: 40 });
  });

  it("logs format_error and refused rows when the call fails", async () => {
    const bad = fakeSink();
    await expect(createClaude({ client: fakeClient(["nope", "nope"]).client, sink: bad.sink }).callJson(Schema, args)).rejects.toThrow();
    expect(bad.rows[0]).toMatchObject({ status: "format_error", attempts: 2 });
    expect(bad.rows[0].errorMessage).toMatch(/JSON/);

    const create = vi.fn(async () => ({ stop_reason: "refusal", content: [], usage: { input_tokens: 5, output_tokens: 0 } }));
    const refused = fakeSink();
    await expect(createClaude({ client: { messages: { create } } as unknown as ClaudeClient, sink: refused.sink }).callJson(Schema, args)).rejects.toThrow();
    expect(refused.rows[0]).toMatchObject({ status: "refused", attempts: 2, inputTokens: 10 });
  });

  it("logs an error row when the API throws, then rethrows", async () => {
    const create = vi.fn(async () => {
      throw new Error("overloaded");
    });
    const { rows, sink } = fakeSink();
    await expect(createClaude({ client: { messages: { create } } as unknown as ClaudeClient, sink }).callJson(Schema, args)).rejects.toThrow("overloaded");
    expect(rows[0]).toMatchObject({ status: "error", attempts: 1, errorMessage: "overloaded", costUsd: 0 });
  });

  it("never lets a logging failure break the call", async () => {
    const { client } = fakeClient(['{"what":"x","significance":1}']);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await createClaude({ client, sink: async () => { throw new Error("db down"); } }).callJson(Schema, args);
    expect(res.data.what).toBe("x");
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe("callJson budget", () => {
  it("skips the call, logs skipped_budget and throws AiBudgetError when the estimate exceeds what is left today", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":1}']);
    const { rows, sink } = fakeSink();
    const budget = budgetOf({ today: 0.9999 });
    const claude = createClaude({ client, sink, budget });
    const err = await claude.callJson(Schema, { ...args, maxTokens: 4000, meta: { purpose: "compose", userId: "u1" } }).catch((e) => e);
    expect(err).toBeInstanceOf(AiBudgetError);
    expect(err).not.toBeInstanceOf(DemoLimitError);
    expect(create).not.toHaveBeenCalled();
    expect(budget.snapshot).toHaveBeenCalledWith("u1", expect.any(Date));
    expect(rows[0]).toMatchObject({ status: "skipped_budget", attempts: 0, costUsd: 0, inputTokens: 0, userId: "u1" });
    expect(rows[0].estCostUsd).toBeGreaterThan(0);
  });

  it("calls through when the estimate fits", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":1}']);
    await createClaude({ client, sink: fakeSink().sink, budget: budgetOf({ today: 0.5 }) }).callJson(Schema, { ...args, meta: { purpose: "analyse", userId: "u1" } });
    expect(create).toHaveBeenCalledTimes(1);
  });

  it("caps demo users at their session budget with DemoLimitError", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":1}']);
    const { rows, sink } = fakeSink();
    const claude = createClaude({ client, sink, budget: budgetOf({ today: 0.01, total: 0.25, isDemo: true }) });
    await expect(claude.callJson(Schema, { ...args, meta: { purpose: "compose", userId: "demo-u" } })).rejects.toBeInstanceOf(DemoLimitError);
    expect(create).not.toHaveBeenCalled();
    expect(rows[0]).toMatchObject({ status: "skipped_budget", isDemo: true });
  });

  it("skips the budget check for calls without a user", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":1}']);
    const budget = budgetOf({ today: 5 });
    await createClaude({ client, sink: fakeSink().sink, budget }).callJson(Schema, args);
    expect(budget.snapshot).not.toHaveBeenCalled();
    expect(create).toHaveBeenCalledTimes(1);
  });
});
