import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { apiBudget } from "@/db/schema";
import { LIMITS, shouldBackOff, windowsFor, type BudgetWindow } from "@/lib/budget";
import { getAccessToken } from "./tokens";

export const GRAPHQL_URL = "https://api.buffer.com";

export class BudgetError extends Error {
  constructor(public retryAfter: number) {
    super(`Shiplog's Buffer API budget is nearly used up; retry in ${retryAfter}s`);
    this.name = "BudgetError";
  }
}

export class RateLimitError extends Error {
  constructor(public retryAfter: number, public window?: string) {
    super(`Buffer rate limit exceeded${window ? ` (${window})` : ""}; retry in ${retryAfter}s`);
    this.name = "RateLimitError";
  }
}

export class BufferError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "BufferError";
  }
}

export interface BudgetStore {
  /** Usage for the given window keys (missing keys count as 0). */
  read(keys: string[]): Promise<Map<string, number>>;
  increment(keys: string[]): Promise<void>;
}

export class MemoryBudgetStore implements BudgetStore {
  used = new Map<string, number>();
  async read(keys: string[]) {
    return new Map(keys.map((k) => [k, this.used.get(k) ?? 0]));
  }
  async increment(keys: string[]) {
    for (const k of keys) this.used.set(k, (this.used.get(k) ?? 0) + 1);
  }
}

export const drizzleBudgetStore: BudgetStore = {
  async read(keys) {
    const rows = await db.select().from(apiBudget).where(inArray(apiBudget.window, keys));
    return new Map(keys.map((k) => [k, rows.find((r) => r.window === k)?.used ?? 0]));
  },
  async increment(keys) {
    await db
      .insert(apiBudget)
      .values(keys.map((window) => ({ window, used: 1 })))
      .onConflictDoUpdate({ target: apiBudget.window, set: { used: sql`${apiBudget.used} + 1` } });
  },
};

function nextReset(w: BudgetWindow, now: Date): Date {
  const [y, m, d, h, min] = [now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes()];
  if (w === "15m") return new Date(Date.UTC(y, m, d, h, Math.floor(min / 15) * 15 + 15));
  if (w === "24h") return new Date(Date.UTC(y, m, d + 1));
  return new Date(Date.UTC(y, m + 1, 1));
}

export function budgetRetryAfter(usage: Record<BudgetWindow, number>, now: Date, ratio = 0.8): number {
  const exhausted = (Object.keys(LIMITS) as BudgetWindow[]).filter((k) => usage[k] >= LIMITS[k] * ratio);
  const resets = exhausted.map((k) => nextReset(k, now).getTime());
  return Math.max(0, Math.ceil((Math.max(now.getTime(), ...resets) - now.getTime()) / 1000));
}

// RateLimit: "100-in-15min";r=0;t=897, "…" — fetch joins repeated headers with ", ".
function retryAfterFrom(res: Response): number {
  const header = Number(res.headers.get("Retry-After"));
  if (Number.isFinite(header) && header > 0) return header;
  const policies = (res.headers.get("RateLimit") ?? "").split(/,\s*(?=")/);
  const waits = policies
    .map((p) => ({ r: /;\s*r=(\d+)/.exec(p)?.[1], t: /;\s*t=(\d+)/.exec(p)?.[1] }))
    .filter((p) => p.r === "0" && p.t)
    .map((p) => Number(p.t));
  return waits.length ? Math.max(...waits) : 60;
}

type GqlError = { message: string; extensions?: { code?: string; window?: string } };
type GqlResponse<T> = { data?: T; errors?: GqlError[] };

export type ClientDeps = {
  getToken?: (userId: string) => Promise<string>;
  budget?: BudgetStore;
  fetchFn?: typeof fetch;
  now?: () => Date;
};

export async function bufferGql<T>(
  userId: string,
  query: string,
  variables: Record<string, unknown> = {},
  deps: ClientDeps = {},
): Promise<T> {
  const getToken = deps.getToken ?? ((id: string) => getAccessToken(id));
  const budget = deps.budget ?? drizzleBudgetStore;
  const fetchFn = deps.fetchFn ?? fetch;
  const now = (deps.now ?? (() => new Date()))();

  const token = await getToken(userId);

  const keys = windowsFor(now);
  const read = await budget.read(keys);
  const usage = Object.fromEntries(keys.map((k) => [k.split(":")[0], read.get(k) ?? 0])) as Record<BudgetWindow, number>;
  if (shouldBackOff(usage)) throw new BudgetError(budgetRetryAfter(usage, now));

  const res = await fetchFn(GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
  });

  if (res.status === 429) {
    const body = (await res.json().catch(() => ({}))) as GqlResponse<unknown>;
    throw new RateLimitError(retryAfterFrom(res), body.errors?.[0]?.extensions?.window);
  }
  // A 429 does not consume quota; everything else does.
  await budget.increment(keys);

  if (res.status === 401) throw new BufferError("UNAUTHORIZED", "Buffer rejected the access token; the user must reconnect Buffer");

  const body = (await res.json().catch(() => null)) as GqlResponse<T> | null;
  if (!body) throw new BufferError("BAD_RESPONSE", `Buffer returned HTTP ${res.status} with a non-JSON body`);
  if (body.errors?.length) {
    const [first] = body.errors;
    throw new BufferError(first.extensions?.code ?? "UNKNOWN", first.message);
  }
  if (!body.data) throw new BufferError("BAD_RESPONSE", "Buffer returned no data");
  return body.data;
}
