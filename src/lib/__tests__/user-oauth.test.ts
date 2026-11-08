import { describe, it, expect, vi } from "vitest";
import { buildUserAuthorizeUrl, exchangeUserCode, InstallationNotOwnedError, verifyInstallation } from "@/lib/github/user-oauth";

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("buildUserAuthorizeUrl", () => {
  it("points at the GitHub web flow with client id, redirect and state", () => {
    const url = new URL(buildUserAuthorizeUrl({ clientId: "Iv1.abc", redirectUri: "https://app/api/github/callback", state: "st" }));
    expect(`${url.origin}${url.pathname}`).toBe("https://github.com/login/oauth/authorize");
    expect(Object.fromEntries(url.searchParams)).toEqual({ client_id: "Iv1.abc", redirect_uri: "https://app/api/github/callback", state: "st" });
  });
});

describe("exchangeUserCode", () => {
  it("posts the code and returns the access token", async () => {
    const fetchFn = vi.fn(async () => json({ access_token: "ghu_1", token_type: "bearer" }));
    const token = await exchangeUserCode("code1", { clientId: "cid", clientSecret: "sec", fetchFn });
    expect(token).toBe("ghu_1");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://github.com/login/oauth/access_token");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Accept).toBe("application/json");
    expect(Object.fromEntries(new URLSearchParams(init.body as string))).toEqual({ client_id: "cid", client_secret: "sec", code: "code1" });
  });

  it("throws when GitHub returns an error body", async () => {
    const fetchFn = vi.fn(async () => json({ error: "bad_verification_code", error_description: "expired" }));
    await expect(exchangeUserCode("old", { clientId: "c", clientSecret: "s", fetchFn })).rejects.toThrow(/bad_verification_code/);
  });
});

function githubApi(pages: { id: number }[][]) {
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input));
    if (url.pathname === "/user") return json({ id: 42, login: "octo" });
    if (url.pathname === "/user/installations") {
      const page = Number(url.searchParams.get("page") ?? 1);
      return json({ total_count: pages.flat().length, installations: pages[page - 1] ?? [] });
    }
    return json({ message: "Not Found" }, 404);
  });
}

describe("verifyInstallation", () => {
  it("returns the GitHub user when the installation is accessible", async () => {
    const fetchFn = githubApi([[{ id: 7 }, { id: 9 }]]);
    await expect(verifyInstallation("ghu_1", 9, fetchFn)).resolves.toEqual({ userId: 42, login: "octo" });
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer ghu_1");
    expect(headers["X-GitHub-Api-Version"]).toBe("2022-11-28");
  });

  it("throws InstallationNotOwnedError when it is not in the list", async () => {
    await expect(verifyInstallation("ghu_1", 99, githubApi([[{ id: 7 }]]))).rejects.toBeInstanceOf(InstallationNotOwnedError);
  });

  it("follows pagination", async () => {
    const full = Array.from({ length: 100 }, (_, i) => ({ id: i + 1 }));
    const fetchFn = githubApi([full, [{ id: 555 }]]);
    await expect(verifyInstallation("t", 555, fetchFn)).resolves.toEqual({ userId: 42, login: "octo" });
    const pagesAsked = fetchFn.mock.calls.map(([u]) => new URL(String(u))).filter((u) => u.pathname === "/user/installations").map((u) => u.searchParams.get("page"));
    expect(pagesAsked).toEqual(["1", "2"]);
  });

  it("throws on a failed API call", async () => {
    const fetchFn = vi.fn(async () => json({ message: "Bad credentials" }, 401));
    await expect(verifyInstallation("bad", 1, fetchFn)).rejects.toThrow(/401/);
  });
});
