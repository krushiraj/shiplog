import { NextResponse, type NextRequest } from "next/server";
import { createDemoUser, createRateLimiter } from "@/lib/demo";
import { setSession } from "@/lib/session";

export const dynamic = "force-dynamic";

const allow = createRateLimiter(10, 60 * 60_000);

export async function GET(req: NextRequest) {
  const appUrl = process.env.APP_URL ?? req.nextUrl.origin;
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  if (!allow(ip)) {
    return new NextResponse("Too many demo sessions from this network. Try again in an hour.", { status: 429 });
  }
  try {
    const { userId } = await createDemoUser();
    await setSession(userId);
    return NextResponse.redirect(new URL("/inbox?demo=1", appUrl));
  } catch (e) {
    console.error("Demo setup failed", e);
    return NextResponse.redirect(new URL("/?demo_error=1", appUrl));
  }
}
