import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";

export const MODEL = "claude-sonnet-5-5";

export type ClaudeClient = Pick<Anthropic, "messages">;

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type CallJsonArgs = {
  system: string;
  user: string;
  maxTokens: number;
  cacheSystem?: boolean;
  effort?: "low" | "medium" | "high";
};

export class AiFormatError extends Error {
  constructor(
    message: string,
    readonly raw: string,
    readonly usage: Usage,
  ) {
    super(message);
    this.name = "AiFormatError";
  }
}

const JSON_ONLY = "\n\nRespond with a single JSON object only. No prose, no code fences.";

function balancedSlice(text: string, start: number): string | null {
  const open = text[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === "\\") i++;
      else if (c === '"') inString = false;
    } else if (c === '"') inString = true;
    else if (c === open) depth++;
    else if (c === close && --depth === 0) return text.slice(start, i + 1);
  }
  return null;
}

export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  for (const m of trimmed.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/g)) candidates.push(m[1].trim());
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] !== "{" && trimmed[i] !== "[") continue;
    const slice = balancedSlice(trimmed, i);
    if (slice) candidates.push(slice);
  }
  for (const c of candidates) {
    try {
      return JSON.parse(c);
    } catch {}
  }
  throw new Error("No JSON object found in the response");
}

function usageOf(u: Anthropic.Usage | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens ?? 0,
    cacheWriteTokens: u?.cache_creation_input_tokens ?? 0,
  };
}

const addUsage = (a: Usage, b: Usage): Usage => ({
  inputTokens: a.inputTokens + b.inputTokens,
  outputTokens: a.outputTokens + b.outputTokens,
  cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
  cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
});

export function createClaude({ client }: { client?: ClaudeClient } = {}) {
  let real: ClaudeClient | undefined = client;
  const getClient = () => (real ??= new Anthropic());

  async function callJson<T>(schema: ZodType<T>, args: CallJsonArgs): Promise<{ data: T; usage: Usage }> {
    const system: Anthropic.MessageCreateParamsNonStreaming["system"] = args.cacheSystem
      ? [{ type: "text", text: args.system + JSON_ONLY, cache_control: { type: "ephemeral" } }]
      : args.system + JSON_ONLY;
    const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.user }];
    let usage: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    let lastError = "";
    let raw = "";

    for (let attempt = 0; attempt < 2; attempt++) {
      const res = await getClient().messages.create({
        model: MODEL,
        max_tokens: args.maxTokens,
        system,
        messages,
        output_config: { effort: args.effort ?? "medium" },
      });
      usage = addUsage(usage, usageOf(res.usage));
      raw = res.content
        .filter((b): b is Anthropic.TextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");

      if (res.stop_reason === "refusal") lastError = "The model declined the request";
      else {
        try {
          const parsed = schema.safeParse(extractJson(raw));
          if (parsed.success) return { data: parsed.data, usage };
          lastError = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
        } catch (e) {
          lastError = (e as Error).message;
        }
      }

      const correction = `Your previous response was invalid: ${lastError}. Reply again with corrected JSON only.`;
      if (raw.trim()) messages.push({ role: "assistant", content: raw }, { role: "user", content: correction });
      else messages[0] = { role: "user", content: `${args.user}\n\n${correction}` };
    }
    throw new AiFormatError(`Claude returned invalid JSON twice: ${lastError}`, raw, usage);
  }

  return { callJson };
}

let shared: ReturnType<typeof createClaude> | undefined;
export const callJson: ReturnType<typeof createClaude>["callJson"] = (schema, args) =>
  (shared ??= createClaude()).callJson(schema, args);
