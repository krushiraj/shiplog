import type { NextRequest } from "next/server";
import { handleInstallCallback } from "@/lib/github/install-callback";
import { installFlowDeps, toResponse } from "@/lib/github/install-deps";

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;
  return toResponse(await handleInstallCallback(req.nextUrl.searchParams, installFlowDeps(appUrl)), appUrl);
}
