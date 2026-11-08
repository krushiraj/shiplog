import { describe, it, expect } from "vitest";
import { buildAuthorizeUrl, tokenRequestBody, AUTHORIZE_URL, TOKEN_URL } from "@/lib/buffer/oauth";

describe("buildAuthorizeUrl", () => {
  it("builds the Buffer authorize URL with PKCE S256 and consent prompt", () => {
    const url = new URL(
      buildAuthorizeUrl({
        clientId: "cid",
        redirectUri: "https://localhost:3000/api/auth/buffer/callback",
        scopes: "account:read posts:read posts:write offline_access",
        state: "st",
        codeChallenge: "ch",
      }),
    );
    expect(`${url.origin}${url.pathname}`).toBe("https://auth.buffer.com/auth");
    expect(AUTHORIZE_URL).toBe("https://auth.buffer.com/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "cid",
      redirect_uri: "https://localhost:3000/api/auth/buffer/callback",
      response_type: "code",
      scope: "account:read posts:read posts:write offline_access",
      state: "st",
      code_challenge: "ch",
      code_challenge_method: "S256",
      prompt: "consent",
    });
  });

  it("accepts scopes as an array and space-joins them", () => {
    const url = new URL(
      buildAuthorizeUrl({ clientId: "c", redirectUri: "https://x/cb", scopes: ["account:read", "offline_access"], state: "s", codeChallenge: "c" }),
    );
    expect(url.searchParams.get("scope")).toBe("account:read offline_access");
  });
});

describe("tokenRequestBody", () => {
  it("encodes an authorization_code grant with client_secret_post", () => {
    const body = tokenRequestBody({
      grantType: "authorization_code",
      clientId: "cid",
      clientSecret: "sec",
      code: "abc",
      redirectUri: "https://x/cb",
      codeVerifier: "ver",
    });
    expect(body).toBeInstanceOf(URLSearchParams);
    expect(Object.fromEntries(body)).toEqual({
      client_id: "cid",
      client_secret: "sec",
      grant_type: "authorization_code",
      code: "abc",
      redirect_uri: "https://x/cb",
      code_verifier: "ver",
    });
    expect(TOKEN_URL).toBe("https://auth.buffer.com/token");
  });

  it("encodes a refresh_token grant", () => {
    const body = tokenRequestBody({ grantType: "refresh_token", clientId: "cid", clientSecret: "sec", refreshToken: "rt" });
    expect(Object.fromEntries(body)).toEqual({
      client_id: "cid",
      client_secret: "sec",
      grant_type: "refresh_token",
      refresh_token: "rt",
    });
  });

  it("omits client_secret for public clients", () => {
    const body = tokenRequestBody({ grantType: "refresh_token", clientId: "cid", refreshToken: "rt" });
    expect(body.has("client_secret")).toBe(false);
  });
});
