import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AiFormatError, createClaude, extractJson, type ClaudeClient } from "../ai/claude";

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

const args = { system: "sys", user: "usr", maxTokens: 500 };

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
    const { callJson } = createClaude({ client });
    const res = await callJson(Schema, args);
    expect(res.data).toEqual({ what: "Added scoring", significance: 2 });
    expect(res.usage).toEqual({ inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 });
    const params = create.mock.calls[0][0 as never] as Record<string, unknown>;
    expect(params.model).toBe("claude-sonnet-5-5");
    expect(params.max_tokens).toBe(500);
  });

  it("handles JSON in prose and code fences", async () => {
    const { client } = fakeClient(['Here is the card:\n```json\n{"what":"x","significance":0}\n```']);
    const res = await createClaude({ client }).callJson(Schema, args);
    expect(res.data.what).toBe("x");
  });

  it("marks the system prompt for caching when asked", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":0}']);
    await createClaude({ client }).callJson(Schema, { ...args, cacheSystem: true });
    const params = create.mock.calls[0][0 as never] as { system: unknown };
    expect(params.system).toEqual([
      { type: "text", text: expect.stringMatching(/^sys/), cache_control: { type: "ephemeral" } },
    ]);
  });

  it("retries once with the validation error appended, summing usage", async () => {
    const { client, create } = fakeClient(['{"what":"x","significance":7}', '{"what":"x","significance":3}']);
    const res = await createClaude({ client }).callJson(Schema, args);
    expect(res.data.significance).toBe(3);
    expect(create).toHaveBeenCalledTimes(2);
    const retry = create.mock.calls[1][0 as never] as { messages: { role: string; content: string }[] };
    expect(retry.messages.at(-1)!.content).toMatch(/significance/);
    expect(res.usage.inputTokens).toBe(200);
    expect(res.usage.outputTokens).toBe(40);
  });

  it("throws AiFormatError after two invalid responses", async () => {
    const { client, create } = fakeClient(["not json", '{"what":5}']);
    await expect(createClaude({ client }).callJson(Schema, args)).rejects.toBeInstanceOf(AiFormatError);
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("treats a refusal as a format error after retry", async () => {
    const create = vi.fn(async () => ({
      stop_reason: "refusal",
      content: [],
      usage: { input_tokens: 1, output_tokens: 0 },
    }));
    const client = { messages: { create } } as unknown as ClaudeClient;
    await expect(createClaude({ client }).callJson(Schema, args)).rejects.toBeInstanceOf(AiFormatError);
  });
});
