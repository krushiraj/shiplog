import { describe, it, expect, vi } from "vitest";
import { getAccessToken, saveTokens, MemoryTokenStore } from "@/lib/buffer/tokens";

const env = { clientId: "cid", clientSecret: "sec" };
const fastSleep = () => new Promise<void>((r) => setTimeout(r, 1));

function fakeTokenEndpoint(delayMs = 20) {
  let n = 0;
  const bodies: URLSearchParams[] = [];
  const fetchFn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    bodies.push(new URLSearchParams(String(init?.body)));
    n += 1;
    await new Promise((r) => setTimeout(r, delayMs));
    return new Response(
      JSON.stringify({ access_token: `at-${n}`, refresh_token: `rt-${n}`, token_type: "Bearer", expires_in: 3600 }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  });
  return { fetchFn: fetchFn as unknown as typeof fetch, calls: fetchFn, bodies };
}

describe("getAccessToken", () => {
  it("returns a valid token without refreshing", async () => {
    const store = new MemoryTokenStore();
    await saveTokens("u1", { access_token: "at-0", refresh_token: "rt-0", token_type: "Bearer", expires_in: 3600 }, store);
    const { fetchFn, calls } = fakeTokenEndpoint();
    expect(await getAccessToken("u1", { store, fetchFn, ...env })).toBe("at-0");
    expect(calls).not.toHaveBeenCalled();
  });

  it("refreshes exactly once for 5 concurrent callers and persists the rotated refresh token", async () => {
    const store = new MemoryTokenStore();
    await store.save("u1", { accessToken: "at-old", refreshToken: "rt-old", expiresAt: new Date(Date.now() - 1000) });
    const { fetchFn, calls, bodies } = fakeTokenEndpoint();

    const results = await Promise.all(
      Array.from({ length: 5 }, () => getAccessToken("u1", { store, fetchFn, sleep: fastSleep, ...env })),
    );

    expect(calls).toHaveBeenCalledTimes(1);
    expect(results).toEqual(Array(5).fill("at-1"));
    expect(Object.fromEntries(bodies[0])).toMatchObject({ grant_type: "refresh_token", refresh_token: "rt-old", client_secret: "sec" });

    const row = await store.get("u1");
    expect(row?.refreshToken).toBe("rt-1");
    expect(row?.refreshingUntil).toBeNull();
    expect(row!.expiresAt.getTime()).toBeGreaterThan(Date.now() + 60_000);
  });

  it("never reuses a refresh token: a second refresh sends the rotated one", async () => {
    const store = new MemoryTokenStore();
    await store.save("u1", { accessToken: "a", refreshToken: "rt-old", expiresAt: new Date(Date.now() - 1000) });
    const { fetchFn, bodies } = fakeTokenEndpoint(0);
    await getAccessToken("u1", { store, fetchFn, ...env });
    const row = (await store.get("u1"))!;
    await store.save("u1", { accessToken: row.accessToken, refreshToken: row.refreshToken, expiresAt: new Date(Date.now() - 1000) });
    await getAccessToken("u1", { store, fetchFn, ...env });
    expect(bodies.map((b) => b.get("refresh_token"))).toEqual(["rt-old", "rt-1"]);
  });

  it("releases the lock and rethrows when the refresh fails", async () => {
    const store = new MemoryTokenStore();
    await store.save("u1", { accessToken: "a", refreshToken: "r", expiresAt: new Date(Date.now() - 1000) });
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 })) as unknown as typeof fetch;
    await expect(getAccessToken("u1", { store, fetchFn, ...env })).rejects.toThrow(/invalid_grant/);
    expect((await store.get("u1"))?.refreshingUntil).toBeNull();
  });

  it("throws when the user has no tokens", async () => {
    await expect(getAccessToken("nobody", { store: new MemoryTokenStore(), ...env })).rejects.toThrow(/not connected/i);
  });
});
