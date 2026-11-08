import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/db";
import { users } from "@/db/schema";
import { bufferGql } from "@/lib/buffer/client";
import { OAuthError, requestToken } from "@/lib/buffer/oauth";
import { ACCOUNT_QUERY, CHANNELS_QUERY, type AccountResult, type ChannelsResult } from "@/lib/buffer/queries";
import { saveTokens } from "@/lib/buffer/tokens";
import { GITHUB_INSTALL_COOKIE } from "@/lib/github/app";
import { OAUTH_COOKIE, setSession, verifyTemp } from "@/lib/session";

type OAuthCookie = { state: string; verifier: string };

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;
  const fail = (reason: string) => {
    const res = NextResponse.redirect(new URL(`/?auth_error=${encodeURIComponent(reason)}`, appUrl));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  };

  const params = req.nextUrl.searchParams;
  const error = params.get("error");
  if (error) return fail(error);

  const code = params.get("code");
  const state = params.get("state");
  const raw = req.cookies.get(OAUTH_COOKIE)?.value;
  const saved = raw ? await verifyTemp<OAuthCookie>(raw) : null;
  if (!code || !state || !saved || saved.state !== state) return fail("invalid_state");

  try {
    const tokens = await requestToken({
      grantType: "authorization_code",
      clientId: process.env.BUFFER_CLIENT_ID ?? "",
      clientSecret: process.env.BUFFER_CLIENT_SECRET,
      code,
      redirectUri: `${appUrl}/api/auth/buffer/callback`,
      codeVerifier: saved.verifier,
    });

    // No user row yet, so hand the fresh token straight to the client.
    const gqlDeps = { getToken: async () => tokens.access_token };
    const { account } = await bufferGql<AccountResult>("", ACCOUNT_QUERY, {}, gqlDeps);
    const org = account.organizations[0];
    const channels = org
      ? (await bufferGql<ChannelsResult>("", CHANNELS_QUERY, { organizationId: org.id }, gqlDeps)).channels
      : [];

    const profile = {
      email: account.email,
      timezone: account.timezone ?? "UTC",
      organizationId: org?.id ?? null,
      channels,
    };
    const [user] = await db
      .insert(users)
      .values({ bufferAccountId: account.id, ...profile })
      .onConflictDoUpdate({ target: users.bufferAccountId, set: profile })
      .returning({ id: users.id });

    await saveTokens(user.id, tokens);
    await setSession(user.id);

    const pendingInstall = req.cookies.has(GITHUB_INSTALL_COOKIE);
    const res = NextResponse.redirect(new URL(pendingInstall ? "/api/github/installed" : "/onboarding", appUrl));
    res.cookies.delete(OAUTH_COOKIE);
    return res;
  } catch (e) {
    console.error("Buffer OAuth callback failed", e);
    return fail(e instanceof OAuthError ? e.code : "callback_failed");
  }
}
