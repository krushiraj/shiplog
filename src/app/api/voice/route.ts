import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { bufferGql } from "@/lib/buffer/client";
import { SENT_POSTS_QUERY, type SentPostsResult } from "@/lib/buffer/queries";
import { getSessionUserId } from "@/lib/session";
import { extractVoice, VoiceInputError } from "@/lib/voice/extract";

const MAX_SENT = 20;

/** The user's recent sent Buffer posts, for picking voice samples (one Buffer API call). */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in with Buffer first" }, { status: 401 });
  const [user] = await db.select({ org: users.organizationId }).from(users).where(eq(users.id, userId)).limit(1);
  if (!user?.org) return NextResponse.json({ posts: [] });

  try {
    const data = await bufferGql<SentPostsResult>(userId, SENT_POSTS_QUERY, { org: user.org });
    const posts = (data.posts.edges ?? [])
      .map((e) => e.node)
      .filter((p): p is typeof p & { text: string } => Boolean(p.text?.trim()))
      .slice(0, MAX_SENT)
      .map((p) => ({ id: p.id, text: p.text, sentAt: p.sentAt, service: p.channelService }));
    return NextResponse.json({ posts });
  } catch (e) {
    console.error("Fetching sent Buffer posts failed", e);
    return NextResponse.json({ error: "Could not load your Buffer posts. Paste them instead." }, { status: 502 });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in with Buffer first" }, { status: 401 });
  const body = await req.json().catch(() => null);
  try {
    const profiles = await extractVoice(userId, body ?? {});
    return NextResponse.json({ profiles });
  } catch (e) {
    if (e instanceof VoiceInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("Voice extraction failed", e);
    return NextResponse.json({ error: "Could not read your voice. Try again or start from a preset." }, { status: 500 });
  }
}
