import { NextResponse, type NextRequest } from "next/server";
import { clearSession } from "@/lib/session";

export async function POST(req: NextRequest) {
  await clearSession();
  return NextResponse.redirect(new URL("/", process.env.APP_URL ?? req.nextUrl.origin), 303);
}
