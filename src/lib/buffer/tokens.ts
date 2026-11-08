import { and, eq, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { bufferTokens } from "@/db/schema";
import { decrypt, encrypt } from "@/lib/crypto";
import { requestToken, type TokenResponse } from "./oauth";

export type TokenRow = { accessToken: string; refreshToken: string; expiresAt: Date; refreshingUntil: Date | null };
export type NewTokens = { accessToken: string; refreshToken: string; expiresAt: Date };

export interface TokenStore {
  get(userId: string): Promise<TokenRow | null>;
  /** Upsert and clear any refresh lock. */
  save(userId: string, t: NewTokens): Promise<void>;
  /** Atomically take the refresh lock if free or stale; returns the row on success, null if someone else holds it. */
  claimRefresh(userId: string, lockSeconds: number): Promise<TokenRow | null>;
  releaseRefresh(userId: string): Promise<void>;
}

const EXPIRY_MARGIN_S = 30;
const REFRESH_SKEW_MS = 60_000;
const LOCK_S = 30;
const POLL_MS = 500;
const POLL_MAX_MS = 10_000;

export class TokenNotConnectedError extends Error {
  constructor(userId: string) {
    super(`Buffer is not connected for user ${userId}`);
    this.name = "TokenNotConnectedError";
  }
}

export function toNewTokens(t: TokenResponse, now = new Date(), fallbackRefresh?: string): NewTokens {
  const refreshToken = t.refresh_token ?? fallbackRefresh;
  if (!refreshToken) throw new Error("Buffer returned no refresh_token (is offline_access in BUFFER_SCOPES?)");
  return {
    accessToken: t.access_token,
    refreshToken,
    expiresAt: new Date(now.getTime() + (t.expires_in - EXPIRY_MARGIN_S) * 1000),
  };
}

export class MemoryTokenStore implements TokenStore {
  private rows = new Map<string, TokenRow>();
  async get(userId: string) {
    const r = this.rows.get(userId);
    return r ? { ...r } : null;
  }
  async save(userId: string, t: NewTokens) {
    this.rows.set(userId, { ...t, refreshingUntil: null });
  }
  async claimRefresh(userId: string, lockSeconds: number) {
    const r = this.rows.get(userId);
    const now = Date.now();
    if (!r || (r.refreshingUntil && r.refreshingUntil.getTime() >= now)) return null;
    r.refreshingUntil = new Date(now + lockSeconds * 1000);
    return { ...r };
  }
  async releaseRefresh(userId: string) {
    const r = this.rows.get(userId);
    if (r) r.refreshingUntil = null;
  }
}

type Row = typeof bufferTokens.$inferSelect;
const decode = (r: Row): TokenRow => ({
  accessToken: decrypt(r.accessTokenEnc),
  refreshToken: decrypt(r.refreshTokenEnc),
  expiresAt: r.expiresAt,
  refreshingUntil: r.refreshingUntil,
});
// Columns are `timestamp` (no tz) holding UTC, so compare against UTC now.
const utcNow = sql`(now() at time zone 'utc')`;

export const drizzleTokenStore: TokenStore = {
  async get(userId) {
    const [r] = await db.select().from(bufferTokens).where(eq(bufferTokens.userId, userId)).limit(1);
    return r ? decode(r) : null;
  },
  async save(userId, t) {
    const values = {
      accessTokenEnc: encrypt(t.accessToken),
      refreshTokenEnc: encrypt(t.refreshToken),
      expiresAt: t.expiresAt,
      refreshingUntil: null,
    };
    await db.insert(bufferTokens).values({ userId, ...values }).onConflictDoUpdate({ target: bufferTokens.userId, set: values });
  },
  async claimRefresh(userId, lockSeconds) {
    const [r] = await db
      .update(bufferTokens)
      .set({ refreshingUntil: sql`${utcNow} + make_interval(secs => ${lockSeconds})` })
      .where(
        and(
          eq(bufferTokens.userId, userId),
          or(isNull(bufferTokens.refreshingUntil), lt(bufferTokens.refreshingUntil, utcNow)),
        ),
      )
      .returning();
    return r ? decode(r) : null;
  },
  async releaseRefresh(userId) {
    await db.update(bufferTokens).set({ refreshingUntil: null }).where(eq(bufferTokens.userId, userId));
  },
};

export type TokenDeps = {
  store?: TokenStore;
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  clientId?: string;
  clientSecret?: string;
};

export async function saveTokens(userId: string, t: TokenResponse, store: TokenStore = drizzleTokenStore): Promise<void> {
  await store.save(userId, toNewTokens(t));
}

const fresh = (r: TokenRow) => r.expiresAt.getTime() - Date.now() > REFRESH_SKEW_MS;
const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function getAccessToken(userId: string, deps: TokenDeps = {}): Promise<string> {
  const store = deps.store ?? drizzleTokenStore;
  const sleep = deps.sleep ?? defaultSleep;

  const row = await store.get(userId);
  if (!row) throw new TokenNotConnectedError(userId);
  if (fresh(row)) return row.accessToken;

  const claimed = await store.claimRefresh(userId, LOCK_S);
  if (claimed) {
    // Another caller may have finished a refresh between our read and our claim.
    if (fresh(claimed)) {
      await store.releaseRefresh(userId);
      return claimed.accessToken;
    }
    try {
      // Single attempt only: a failed refresh is never retried with the same token (reuse revokes the grant).
      const res = await requestToken(
        {
          grantType: "refresh_token",
          clientId: deps.clientId ?? process.env.BUFFER_CLIENT_ID ?? "",
          clientSecret: deps.clientSecret ?? process.env.BUFFER_CLIENT_SECRET,
          refreshToken: claimed.refreshToken,
        },
        deps.fetchFn,
      );
      const next = toNewTokens(res, new Date(), claimed.refreshToken);
      await store.save(userId, next);
      return next.accessToken;
    } catch (e) {
      await store.releaseRefresh(userId);
      throw e;
    }
  }

  const before = row.expiresAt.getTime();
  for (let waited = 0; waited < POLL_MAX_MS; waited += POLL_MS) {
    await sleep(POLL_MS);
    const r = await store.get(userId);
    if (r && r.expiresAt.getTime() !== before) return r.accessToken;
  }
  throw new Error(`Timed out waiting for another Buffer token refresh for user ${userId}`);
}
