import { eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, users } from "@/db/schema";

/** Each user may spend this much on AI per UTC day. UTC keeps the window the same for every user and every server. */
export const DAILY_USER_BUDGET_USD = 1;
/** A demo session's lifetime AI allowance (demo users are one per session). */
export const DEMO_SESSION_BUDGET_USD = 0.25;

export class AiBudgetError extends Error {
  constructor(
    message: string,
    readonly remainingUsd: number,
    readonly estCostUsd: number,
  ) {
    super(message);
    this.name = "AiBudgetError";
  }
}

export class DemoLimitError extends AiBudgetError {
  constructor(remainingUsd = 0, estCostUsd = 0) {
    super(`The demo allows $${DEMO_SESSION_BUDGET_USD.toFixed(2)} of AI. Connect Buffer to keep going.`, remainingUsd, estCostUsd);
    this.name = "DemoLimitError";
  }
}

export const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

export type SpendSnapshot = { today: number; total: number; isDemo: boolean };

export interface BudgetStore {
  snapshot(userId: string, dayStart: Date): Promise<SpendSnapshot>;
}

export const drizzleBudgetStore: BudgetStore = {
  async snapshot(userId, dayStart) {
    const [[spend], [user]] = await Promise.all([
      db
        .select({
          today: sql<string>`coalesce(sum(${aiUsage.costUsd}) filter (where ${gte(aiUsage.createdAt, dayStart)}), 0)`,
          total: sql<string>`coalesce(sum(${aiUsage.costUsd}), 0)`,
        })
        .from(aiUsage)
        .where(eq(aiUsage.userId, userId)),
      db.select({ account: users.bufferAccountId }).from(users).where(eq(users.id, userId)).limit(1),
    ]);
    return { today: Number(spend?.today ?? 0), total: Number(spend?.total ?? 0), isDemo: !!user?.account.startsWith("demo:") };
  },
};

export type BudgetDeps = { store?: BudgetStore; now?: () => Date };

/** Dollars left today; for demo users, also bounded by what is left of the session allowance. */
export function remainingFrom(snap: SpendSnapshot, isDemo = snap.isDemo): number {
  const daily = DAILY_USER_BUDGET_USD - snap.today;
  return Math.max(0, isDemo ? Math.min(daily, DEMO_SESSION_BUDGET_USD - snap.total) : daily);
}

const snapshotFor = (userId: string, deps: BudgetDeps) =>
  (deps.store ?? drizzleBudgetStore).snapshot(userId, utcDayStart((deps.now ?? (() => new Date()))()));

export async function spentToday(userId: string, deps: BudgetDeps = {}): Promise<number> {
  return (await snapshotFor(userId, deps)).today;
}

export async function remainingToday(userId: string, deps: BudgetDeps = {}): Promise<number> {
  return remainingFrom(await snapshotFor(userId, deps));
}
