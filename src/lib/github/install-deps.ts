import { NextResponse } from "next/server";
import { eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { githubInstallations } from "@/db/schema";
import { cookieOptions, getSessionUserId, signTemp, verifyTemp } from "@/lib/session";
import { getApp, GITHUB_INSTALL_COOKIE } from "./app";
import type { InstallFlowDeps, InstallFlowResult, InstallState } from "./install-callback";
import { buildUserAuthorizeUrl, exchangeUserCode, verifyInstallation } from "./user-oauth";

const STATE_MINUTES = 15;

function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function installFlowDeps(appUrl: string): InstallFlowDeps {
  return {
    sessionUserId: getSessionUserId,
    sign: (p) => signTemp(p, STATE_MINUTES),
    verify: (t) => verifyTemp<InstallState>(t),
    authorizeUrl: (state) => buildUserAuthorizeUrl({ clientId: env("GITHUB_CLIENT_ID"), redirectUri: `${appUrl}/api/github/callback`, state }),
    exchangeCode: (code) => exchangeUserCode(code, { clientId: env("GITHUB_CLIENT_ID"), clientSecret: env("GITHUB_CLIENT_SECRET") }),
    verifyInstallation: (token, id) => verifyInstallation(token, id),
    async getInstallation(id) {
      const { data } = await getApp().octokit.rest.apps.getInstallation({ installation_id: id });
      const account = data.account;
      return { accountLogin: (account && ("login" in account ? account.login : account.slug)) ?? "unknown", suspended: data.suspended_at != null };
    },
    async link(row) {
      const { userId, accountLogin, suspended, githubUserId, githubLogin, verifiedAt } = row;
      // Unverified links (made before verification existed) can be claimed by the verified owner.
      const linked = await db
        .insert(githubInstallations)
        .values(row)
        .onConflictDoUpdate({
          target: githubInstallations.installationId,
          set: { userId, accountLogin, suspended, githubUserId, githubLogin, verifiedAt },
          setWhere: or(isNull(githubInstallations.userId), eq(githubInstallations.userId, userId), isNull(githubInstallations.verifiedAt)),
        })
        .returning({ id: githubInstallations.installationId });
      return linked.length > 0;
    },
    now: () => new Date(),
  };
}

export function toResponse(result: InstallFlowResult, appUrl: string): NextResponse {
  const res = NextResponse.redirect(new URL(result.redirect, appUrl));
  if (result.installCookie) res.cookies.set(GITHUB_INSTALL_COOKIE, result.installCookie, cookieOptions(STATE_MINUTES * 60));
  else if (result.installCookie === null) res.cookies.delete(GITHUB_INSTALL_COOKIE);
  return res;
}
