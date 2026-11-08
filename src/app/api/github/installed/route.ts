import { NextResponse, type NextRequest } from "next/server";
import { eq, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { githubInstallations } from "@/db/schema";
import { getApp, GITHUB_INSTALL_COOKIE } from "@/lib/github/app";
import { cookieOptions, getSessionUserId, signTemp, verifyTemp } from "@/lib/session";

const COOKIE_MINUTES = 15;

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;
  const go = (path: string) => {
    const res = NextResponse.redirect(new URL(path, appUrl));
    res.cookies.delete(GITHUB_INSTALL_COOKIE);
    return res;
  };

  const params = req.nextUrl.searchParams;
  if (params.get("setup_action") === "request") return go("/onboarding?github=requested");

  const fromCookie = req.cookies.get(GITHUB_INSTALL_COOKIE)?.value;
  const saved = fromCookie ? await verifyTemp<{ installationId: number }>(fromCookie) : null;
  const installationId = Number(params.get("installation_id") ?? saved?.installationId);
  if (!Number.isInteger(installationId) || installationId <= 0) return go("/onboarding?github=missing");

  const userId = await getSessionUserId();
  if (!userId) {
    // The Buffer callback (or /onboarding) sends the user back here when this cookie is present.
    const res = NextResponse.redirect(new URL("/api/auth/buffer/start", appUrl));
    res.cookies.set(GITHUB_INSTALL_COOKIE, await signTemp({ installationId }, COOKIE_MINUTES), cookieOptions(COOKIE_MINUTES * 60));
    return res;
  }

  try {
    const { data } = await getApp().octokit.rest.apps.getInstallation({ installation_id: installationId });
    const account = data.account;
    const accountLogin = (account && ("login" in account ? account.login : account.slug)) ?? "unknown";

    // Never move an installation that another user already linked.
    const linked = await db
      .insert(githubInstallations)
      .values({ installationId, userId, accountLogin })
      .onConflictDoUpdate({
        target: githubInstallations.installationId,
        set: { userId, accountLogin, suspended: data.suspended_at != null },
        setWhere: or(isNull(githubInstallations.userId), eq(githubInstallations.userId, userId)),
      })
      .returning({ id: githubInstallations.installationId });
    if (linked.length === 0) return go("/onboarding?github=taken");
  } catch (e) {
    console.error("GitHub installation link failed", e);
    return go("/onboarding?github=error");
  }

  return go(`/onboarding/project?installation=${installationId}`);
}
