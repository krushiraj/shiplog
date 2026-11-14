export type TokenUsage = { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };

export const AI_PURPOSES = [
  "analyse",
  "brief-files",
  "brief",
  "compose",
  "voice-check",
  "voice-extract",
  "rule-proposal",
  "regenerate",
  "other",
] as const;
export type AiPurpose = (typeof AI_PURPOSES)[number];

/** USD per million tokens. */
export type Rates = { input: number; output: number; cacheWrite5m: number; cacheRead: number };
export type ModelPrice = Rates & { longContext?: Rates & { above: number } };

/*
 * Source: Anthropic `claude-api` skill (Claude Code bundle 2.1.314, model table cached 2026-10-06), read 2026-11-08.
 * - claude-sonnet-5-5: "$2 / $10 per MTok input / output, 5-minute cache writes $2.50, 1-hour cache writes $4,
 *   cache reads $0.20" (shared/model-migration.md, Migrating to Claude Sonnet 5.5).
 * - claude-haiku-5-5: "$0.10 / $0.50 per MTok ... when the prompt is 100K tokens or fewer and $0.50 / $2.50 when it
 *   is longer; cache reads are 0.1x the input rate, 5-minute cache writes 1.25x" (Migrating to Claude Haiku 5.5).
 *   The Haiku cache rates below are those multipliers applied to the input rate.
 * Live page to re-check: https://platform.claude.com/docs/en/about-claude/pricing.md
 */
export const PRICES: Record<string, ModelPrice> = {
  "claude-sonnet-5-5": { input: 2, output: 10, cacheWrite5m: 2.5, cacheRead: 0.2 },
  "claude-haiku-5-5": {
    input: 0.1,
    output: 0.5,
    cacheWrite5m: 0.125,
    cacheRead: 0.01,
    longContext: { above: 100_000, input: 0.5, output: 2.5, cacheWrite5m: 0.625, cacheRead: 0.05 },
  },
};

export function priceFor(model: string): ModelPrice {
  const price = PRICES[model];
  if (!price) throw new Error(`No price for model ${model}; add it to src/lib/ai/pricing.ts`);
  return price;
}

const promptTokens = (u: TokenUsage) => u.inputTokens + u.cacheReadTokens + u.cacheWriteTokens;

function ratesFor(model: string, u: TokenUsage): Rates {
  const price = priceFor(model);
  return price.longContext && promptTokens(u) > price.longContext.above ? price.longContext : price;
}

/** Cost of one request in USD. Long-context tiers are chosen per request, so price retries one at a time. */
export function costOf(model: string, u: TokenUsage): number {
  const r = ratesFor(model, u);
  return (u.inputTokens * r.input + u.outputTokens * r.output + u.cacheReadTokens * r.cacheRead + u.cacheWriteTokens * r.cacheWrite5m) / 1e6;
}

/** What the cache reads saved compared with paying the full input rate for those tokens. */
export function cacheSavings(model: string, u: TokenUsage): number {
  const r = ratesFor(model, u);
  return (u.cacheReadTokens * (r.input - r.cacheRead)) / 1e6;
}

/** Characters that are rare in prose and common in code and diffs. */
const CODE_CHARS = /[{}()[\];=<>+\-*/\\|&_:"'`$#@]/g;

/**
 * Rough count without a count_tokens round trip. Prose runs about four characters per token; code and diffs
 * tokenize denser (about three), so the divisor slides with the share of code-like characters.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const codeShare = (text.match(CODE_CHARS)?.length ?? 0) / text.length;
  const charsPerToken = codeShare >= 0.08 ? 3 : codeShare >= 0.04 ? 3.5 : 4;
  return Math.ceil(text.length / charsPerToken);
}

/** Smallest prompt prefix the API will cache; shorter cached prefixes are billed as plain input. */
export const MIN_CACHEABLE_TOKENS = 1024;

/** Typical share of max_tokens a call spends on output (adaptive thinking included). Tune from the usage page. */
export const PURPOSE_OUTPUT_RATIO: Record<AiPurpose, number> = {
  analyse: 0.5,
  "brief-files": 0.4,
  brief: 0.6,
  compose: 0.6,
  "voice-check": 0.5,
  "voice-extract": 0.5,
  "rule-proposal": 0.6,
  regenerate: 0.6,
  other: 0.5,
};

export type CallEstimate = { estInputTokens: number; estOutputTokens: number; estCostUsd: number };

/**
 * Estimate before the call. With `cacheSystem`, a system prompt long enough to cache is priced at the cache-read
 * rate (the usual case for repeated calls); a cold cache costs a little more than this.
 */
export function estimateCall(args: {
  model: string;
  system: string;
  user: string;
  maxTokens: number;
  purpose: AiPurpose;
  cacheSystem?: boolean;
}): CallEstimate {
  const systemTokens = estimateTokens(args.system);
  const userTokens = estimateTokens(args.user);
  const estInputTokens = systemTokens + userTokens;
  const estOutputTokens = Math.min(args.maxTokens, Math.round(args.maxTokens * PURPOSE_OUTPUT_RATIO[args.purpose]));
  const cached = args.cacheSystem && systemTokens >= MIN_CACHEABLE_TOKENS;
  const estCostUsd = costOf(args.model, {
    inputTokens: cached ? userTokens : estInputTokens,
    outputTokens: estOutputTokens,
    cacheReadTokens: cached ? systemTokens : 0,
    cacheWriteTokens: 0,
  });
  return { estInputTokens, estOutputTokens, estCostUsd };
}
