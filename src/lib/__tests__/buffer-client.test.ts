import { describe, it, expect, vi } from "vitest";
import { bufferGql, BudgetError, RateLimitError, BufferError, MemoryBudgetStore, budgetRetryAfter } from "@/lib/buffer/client";
import { LIMITS, windowsFor } from "@/lib/budget";

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" }, ...init });

function deps(response: Response, budget = new MemoryBudgetStore()) {
  const fetchFn = vi.fn(async () => response);
  return { budget, fetchFn, d: { budget, fetchFn: fetchFn as unknown as typeof fetch, getToken: async () => "tok", now: () => new Date("2026-11-08T12:22:00Z") } };
}

describe("bufferGql", () => {
  it("posts to api.buffer.com with bearer auth, returns data and counts all 3 windows", async () => {
    const { budget, fetchFn, d } = deps(json({ data: { account: { id: "a1" } } }));
    const data = await bufferGql<{ account: { id: string } }>("u1", "query { account { id } }", {}, d);
    expect(data.account.id).toBe("a1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.buffer.com");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(JSON.parse(String(init.body))).toEqual({ query: "query { account { id } }", variables: {} });
    for (const k of windowsFor(d.now())) expect(budget.used.get(k)).toBe(1);
  });

  it("throws BudgetError without calling Buffer when a window is at 80%", async () => {
    const budget = new MemoryBudgetStore();
    budget.used.set(windowsFor(new Date("2026-11-08T12:22:00Z"))[0], LIMITS["15m"] * 0.8);
    const { fetchFn, d } = deps(json({ data: {} }), budget);
    const err = (await bufferGql("u1", "q", {}, d).catch((e) => e)) as BudgetError;
    expect(err).toBeInstanceOf(BudgetError);
    expect(err.retryAfter).toBe(8 * 60); // 12:22 -> 12:30
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("throws RateLimitError with Retry-After on 429 and does not count it", async () => {
    const { budget, d } = deps(
      json({ errors: [{ message: "Too many", extensions: { code: "RATE_LIMIT_EXCEEDED", window: "15m" } }] }, { status: 429, headers: { "Retry-After": "120" } }),
    );
    const err = (await bufferGql("u1", "q", {}, d).catch((e) => e)) as RateLimitError;
    expect(err).toBeInstanceOf(RateLimitError);
    expect(err.retryAfter).toBe(120);
    expect(budget.used.size).toBe(0);
  });

  it("throws BufferError with the extension code on GraphQL errors", async () => {
    const { d } = deps(json({ errors: [{ message: "nope", extensions: { code: "FORBIDDEN" } }] }));
    const err = (await bufferGql("u1", "q", {}, d).catch((e) => e)) as BufferError;
    expect(err).toBeInstanceOf(BufferError);
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toBe("nope");
  });

  it("maps HTTP 401 to BufferError UNAUTHORIZED", async () => {
    const { d } = deps(new Response("unauthorized", { status: 401 }));
    const err = (await bufferGql("u1", "q", {}, d).catch((e) => e)) as BufferError;
    expect(err).toBeInstanceOf(BufferError);
    expect(err.code).toBe("UNAUTHORIZED");
  });
});

describe("budgetRetryAfter", () => {
  it("waits for the latest reset among exhausted windows", () => {
    const now = new Date("2026-11-08T12:22:00Z");
    expect(budgetRetryAfter({ "15m": 100, "24h": 0, "30d": 0 }, now)).toBe(8 * 60);
    expect(budgetRetryAfter({ "15m": 100, "24h": 250, "30d": 0 }, now)).toBe(11 * 3600 + 38 * 60);
  });
});
