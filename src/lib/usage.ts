import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, drafts, projects, users } from "@/db/schema";
import { DAILY_USER_BUDGET_USD, DEMO_SESSION_BUDGET_USD, drizzleBudgetStore, remainingFrom, utcDayStart, type BudgetStore } from "@/lib/ai/budget";

export type UsageRow = {
  id: string;
  createdAt: Date;
  purpose: string;
  model: string;
  projectId: string | null;
  projectName: string | null;
  refType: string | null;
  refId: string | null;
  estInputTokens: number;
  estOutputTokens: number;
  estCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  cacheSavingsUsd: number;
  latencyMs: number;
  attempts: number;
  status: string;
  errorMessage: string | null;
};

export type UsageTotals = {
  calls: number;
  skipped: number;
  costUsd: number;
  estCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cacheSavingsUsd: number;
};

export type PurposeUsage = UsageTotals & {
  purpose: string;
  /** Actual cost over estimated cost, for calls that ran. Above 1 means estimates run low. */
  accuracy: number | null;
  inputAccuracy: number | null;
  outputAccuracy: number | null;
};

export type ProjectUsage = UsageTotals & { projectId: string | null; projectName: string };

export type UsageBudget = { limitUsd: number; spentUsd: number; remainingUsd: number; scope: "today" | "demo" };

export type UsageSummary = {
  windows: { today: UsageTotals; d7: UsageTotals; d30: UsageTotals; all: UsageTotals };
  byPurpose: PurposeUsage[];
  byProject: ProjectUsage[];
  cacheHitRatio: number | null;
  costPerCard: number | null;
  costPerPostedDraft: number | null;
  budget: UsageBudget;
  recent: UsageRow[];
};

export interface UsageSource {
  rows(userId: string): Promise<UsageRow[]>;
  postedDrafts(userId: string): Promise<number>;
  isDemo(userId: string): Promise<boolean>;
}

const DAY_MS = 86_400_000;
const RECENT = 50;
/** Purposes whose spend goes into writing a post. */
const DRAFTING = new Set(["compose", "regenerate", "voice-check", "rule-proposal"]);

const round = (n: number) => Math.round(n * 1e6) / 1e6;
const ratio = (a: number, b: number) => (b > 0 ? a / b : null);

function totals(rows: UsageRow[]): UsageTotals {
  const t: UsageTotals = { calls: 0, skipped: 0, costUsd: 0, estCostUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cacheSavingsUsd: 0 };
  for (const r of rows) {
    t.calls++;
    if (r.status === "skipped_budget") t.skipped++;
    t.costUsd += r.costUsd;
    t.estCostUsd += r.estCostUsd;
    t.inputTokens += r.inputTokens;
    t.outputTokens += r.outputTokens;
    t.cacheReadTokens += r.cacheReadTokens;
    t.cacheWriteTokens += r.cacheWriteTokens;
    t.cacheSavingsUsd += r.cacheSavingsUsd;
  }
  return { ...t, costUsd: round(t.costUsd), estCostUsd: round(t.estCostUsd), cacheSavingsUsd: round(t.cacheSavingsUsd) };
}

function groupBy<K>(rows: UsageRow[], key: (r: UsageRow) => K): Map<K, UsageRow[]> {
  const groups = new Map<K, UsageRow[]>();
  for (const r of rows) groups.set(key(r), [...(groups.get(key(r)) ?? []), r]);
  return groups;
}

export function summariseUsage(rows: UsageRow[], ctx: { postedDrafts: number; isDemo: boolean; now: Date }): UsageSummary {
  const since = (t: number) => rows.filter((r) => r.createdAt.getTime() >= t);
  const all = totals(rows);
  const today = totals(since(utcDayStart(ctx.now).getTime()));

  const byPurpose = [...groupBy(rows, (r) => r.purpose)]
    .map(([purpose, group]) => {
      const ran = group.filter((r) => r.status !== "skipped_budget");
      const sum = (f: (r: UsageRow) => number) => ran.reduce((a, r) => a + f(r), 0);
      return {
        purpose,
        ...totals(group),
        accuracy: ratio(sum((r) => r.costUsd), sum((r) => r.estCostUsd)),
        inputAccuracy: ratio(sum((r) => r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens), sum((r) => r.estInputTokens)),
        outputAccuracy: ratio(sum((r) => r.outputTokens), sum((r) => r.estOutputTokens)),
      };
    })
    .sort((a, b) => b.costUsd - a.costUsd);

  const byProject = [...groupBy(rows, (r) => r.projectId)]
    .map(([projectId, group]) => ({ projectId, projectName: group.find((r) => r.projectName)?.projectName ?? "No project", ...totals(group) }))
    .sort((a, b) => b.costUsd - a.costUsd);

  const analysed = rows.filter((r) => r.purpose === "analyse");
  const cards = new Set(analysed.filter((r) => r.status === "ok" || r.status === "retried").map((r) => r.refId)).size;
  const drafting = rows.filter((r) => DRAFTING.has(r.purpose)).reduce((a, r) => a + r.costUsd, 0);

  const limitUsd = ctx.isDemo ? DEMO_SESSION_BUDGET_USD : DAILY_USER_BUDGET_USD;
  const spentUsd = ctx.isDemo ? all.costUsd : today.costUsd;

  return {
    windows: { today, d7: totals(since(ctx.now.getTime() - 7 * DAY_MS)), d30: totals(since(ctx.now.getTime() - 30 * DAY_MS)), all },
    byPurpose,
    byProject,
    cacheHitRatio: ratio(all.cacheReadTokens, all.inputTokens + all.cacheReadTokens + all.cacheWriteTokens),
    costPerCard: ratio(analysed.reduce((a, r) => a + r.costUsd, 0), cards),
    costPerPostedDraft: ratio(drafting, ctx.postedDrafts),
    budget: { limitUsd, spentUsd, remainingUsd: round(Math.max(0, limitUsd - spentUsd)), scope: ctx.isDemo ? "demo" : "today" },
    recent: [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, RECENT),
  };
}

export const drizzleUsageSource: UsageSource = {
  async rows(userId) {
    const rows = await db.select().from(aiUsage).where(eq(aiUsage.userId, userId)).orderBy(desc(aiUsage.createdAt));
    return rows.map((r) => ({
      ...r,
      estCostUsd: Number(r.estCostUsd),
      costUsd: Number(r.costUsd),
      cacheSavingsUsd: Number(r.cacheSavingsUsd),
    }));
  },
  async postedDrafts(userId) {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .where(and(eq(projects.userId, userId), eq(drafts.status, "posted")));
    return row?.n ?? 0;
  },
  async isDemo(userId) {
    const [row] = await db.select({ account: users.bufferAccountId }).from(users).where(eq(users.id, userId)).limit(1);
    return !!row?.account.startsWith("demo:");
  },
};

export type UsageDeps = { source?: UsageSource; now?: () => Date };

export async function loadUsage(userId: string, deps: UsageDeps = {}): Promise<UsageSummary> {
  const source = deps.source ?? drizzleUsageSource;
  const [rows, postedDrafts, isDemo] = await Promise.all([source.rows(userId), source.postedDrafts(userId), source.isDemo(userId)]);
  return summariseUsage(rows, { postedDrafts, isDemo, now: (deps.now ?? (() => new Date()))() });
}

/** Today's spend against the budget, cheap enough for every page load (sidebar footer). */
export async function budgetFor(userId: string, deps: { store?: BudgetStore; now?: () => Date } = {}): Promise<UsageBudget> {
  const snap = await (deps.store ?? drizzleBudgetStore).snapshot(userId, utcDayStart((deps.now ?? (() => new Date()))()));
  return snap.isDemo
    ? { limitUsd: DEMO_SESSION_BUDGET_USD, spentUsd: round(snap.total), remainingUsd: round(remainingFrom(snap)), scope: "demo" }
    : { limitUsd: DAILY_USER_BUDGET_USD, spentUsd: round(snap.today), remainingUsd: round(remainingFrom(snap)), scope: "today" };
}
