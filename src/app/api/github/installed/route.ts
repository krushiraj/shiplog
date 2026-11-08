import type { NextRequest } from "next/server";
import { GITHUB_INSTALL_COOKIE } from "@/lib/github/app";
import { handleInstalled } from "@/lib/github/install-callback";
import { installFlowDeps, toResponse } from "@/lib/github/install-deps";

// Never links on its own: it only routes into GitHub user authorization, which /api/github/callback verifies.
export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;
  const cookie = req.cookies.get(GITHUB_INSTALL_COOKIE)?.value ?? null;
  return toResponse(await handleInstalled(req.nextUrl.searchParams, cookie, installFlowDeps(appUrl)), appUrl);
}
