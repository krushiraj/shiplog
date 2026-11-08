import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { loadUsage } from "@/lib/usage";

export const dynamic = "force-dynamic";

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in first" }, { status: 401 });
  return NextResponse.json(await loadUsage(userId));
}
