import Anthropic from "@anthropic-ai/sdk";
import type { ZodType } from "zod";
import { AiBudgetError, DemoLimitError, drizzleBudgetStore, remainingFrom, utcDayStart, type BudgetStore } from "./budget";
import { cacheSavings, costOf, estimateCall, type AiPurpose } from "./pricing";
import { drizzleUsageSink, type AiCallStatus, type AiRefType, type AiUsageRecord, type UsageSink } from "./usage-log";

export const MODEL = "claude-sonnet-5-5";
export type AiModel = "claude-sonnet-5-5" | "claude-haiku-5-5";

export type ClaudeClient = Pick<Anthropic, "messages">;

export type Usage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export type CallJsonArgs = {
  system: string;
  user: string;
  maxTokens: number;
  cacheSystem?: boolean;
  effort?: "low" | "medium" | "high";
  model?: AiModel;
  meta: AiCallMeta;
};

export type AiCallMeta = {
  purpose: AiPurpose;
  /** Spend is charged to this user; without it the daily budget is not checked. */
  userId?: string | null;
  projectId?: string | null;
  projectName?: string | null;
  refType?: AiRefType;
  refId?: string | null;
  isDemo?: boolean;
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

const ZERO: Usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };

let globalSink: UsageSink = drizzleUsageSink;
/** Replaces where usage rows go for the shared client (tests, scripts). */
export const setUsageSink = (sink: UsageSink) => void (globalSink = sink);

export type ClaudeDeps = { client?: ClaudeClient; sink?: UsageSink; budget?: BudgetStore; now?: () => number };

export function createClaude(deps: ClaudeDeps = {}) {
  let real: ClaudeClient | undefined = deps.client;
  const getClient = () => (real ??= new Anthropic());
  const sink = deps.sink ?? ((row: AiUsageRecord) => globalSink(row));
  const budget = deps.budget ?? drizzleBudgetStore;
  const now = deps.now ?? Date.now;

  async function log(row: AiUsageRecord) {
    try {
      await sink(row);
    } catch (e) {
      console.error("Could not record AI usage", e);
    }
  }

  async function callJson<T>(schema: ZodType<T>, args: CallJsonArgs): Promise<{ data: T; usage: Usage }> {
    const model = args.model ?? MODEL;
    const { meta } = args;
    const system: Anthropic.MessageCreateParamsNonStreaming["system"] = args.cacheSystem
      ? [{ type: "text", text: args.system + JSON_ONLY, cache_control: { type: "ephemeral" } }]
      : args.system + JSON_ONLY;
    const est = estimateCall({ model, system: args.system + JSON_ONLY, user: args.user, maxTokens: args.maxTokens, purpose: meta.purpose, cacheSystem: args.cacheSystem });
    const started = now();
    let isDemo = meta.isDemo ?? false;
    let usage = ZERO;
    let costUsd = 0;
    let savingsUsd = 0;
    let attempts = 0;

    const record = (status: AiCallStatus, errorMessage: string | null = null) =>
      log({
        userId: meta.userId ?? null,
        projectId: meta.projectId ?? null,
        projectName: meta.projectName ?? null,
        purpose: meta.purpose,
        model,
        refType: meta.refType ?? null,
        refId: meta.refId ?? null,
        ...est,
        ...usage,
        costUsd,
        cacheSavingsUsd: savingsUsd,
        latencyMs: Math.max(0, Math.round(now() - started)),
        attempts,
        status,
        errorMessage,
        isDemo,
      });

    if (meta.userId) {
      let remaining = Number.POSITIVE_INFINITY;
      try {
        const snap = await budget.snapshot(meta.userId, utcDayStart(new Date()));
        isDemo = meta.isDemo ?? snap.isDemo;
        remaining = remainingFrom(snap, isDemo);
      } catch (e) {
        // Fail open: a budget lookup outage should not stop drafting; the call is still logged.
        console.error("Could not check the AI budget", e);
      }
      if (est.estCostUsd > remaining) {
        const err = isDemo
          ? new DemoLimitError(remaining, est.estCostUsd)
          : new AiBudgetError(
              `Daily AI budget reached: this call needs about $${est.estCostUsd.toFixed(4)} and $${remaining.toFixed(4)} is left today`,
              remaining,
              est.estCostUsd,
            );
        await record("skipped_budget", err.message);
        throw err;
      }
    }

    const messages: Anthropic.MessageParam[] = [{ role: "user", content: args.user }];
    let lastError = "";
    let raw = "";
    let refused = false;

    try {
      while (attempts < 2) {
        attempts++;
        const res = await getClient().messages.create({
          model,
          max_tokens: args.maxTokens,
          system,
          messages,
          output_config: { effort: args.effort ?? "medium" },
        });
        const u = usageOf(res.usage);
        usage = addUsage(usage, u);
        costUsd += costOf(model, u);
        savingsUsd += cacheSavings(model, u);
        raw = res.content
          .filter((b): b is Anthropic.TextBlock => b.type === "text")
          .map((b) => b.text)
          .join("");

        refused = res.stop_reason === "refusal";
        if (refused) lastError = "The model declined the request";
        else {
          try {
            const parsed = schema.safeParse(extractJson(raw));
            if (parsed.success) {
              await record(attempts === 1 ? "ok" : "retried");
              return { data: parsed.data, usage };
            }
            lastError = parsed.error.issues.map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`).join("; ");
          } catch (e) {
            lastError = (e as Error).message;
          }
        }

        const correction = `Your previous response was invalid: ${lastError}. Reply again with corrected JSON only.`;
        if (raw.trim()) messages.push({ role: "assistant", content: raw }, { role: "user", content: correction });
        else messages[0] = { role: "user", content: `${args.user}\n\n${correction}` };
      }
    } catch (e) {
      await record("error", (e as Error).message);
      throw e;
    }
    const err = new AiFormatError(`Claude returned invalid JSON twice: ${lastError}`, raw, usage);
    await record(refused ? "refused" : "format_error", err.message);
    throw err;
  }

  return { callJson };
}

let shared: ReturnType<typeof createClaude> | undefined;
export const callJson: ReturnType<typeof createClaude>["callJson"] = (schema, args) =>
  (shared ??= createClaude()).callJson(schema, args);
