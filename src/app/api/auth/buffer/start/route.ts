import { NextResponse } from "next/server";
import { buildAuthorizeUrl } from "@/lib/buffer/oauth";
import { createPkce, randomState } from "@/lib/pkce";
import { OAUTH_COOKIE, cookieOptions, signTemp } from "@/lib/session";

const OAUTH_MINUTES = 10;

export async function GET() {
  const appUrl = process.env.APP_URL;
  const clientId = process.env.BUFFER_CLIENT_ID;
  if (!appUrl || !clientId) return NextResponse.json({ error: "Buffer OAuth is not configured" }, { status: 500 });

  const state = randomState();
  const { verifier, challenge } = await createPkce();
  const authorizeUrl = buildAuthorizeUrl({
    clientId,
    redirectUri: `${appUrl}/api/auth/buffer/callback`,
    scopes: process.env.BUFFER_SCOPES ?? "account:read posts:read posts:write offline_access",
    state,
    codeChallenge: challenge,
  });

  const res = NextResponse.redirect(authorizeUrl);
  res.cookies.set(OAUTH_COOKIE, await signTemp({ state, verifier }, OAUTH_MINUTES), cookieOptions(OAUTH_MINUTES * 60));
  return res;
}
