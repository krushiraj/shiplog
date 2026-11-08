import { NextResponse, type NextRequest } from "next/server";
import { BudgetError, RateLimitError } from "@/lib/buffer/client";
import { getSessionUserId } from "@/lib/session";
import { extractVoice, VoiceInputError } from "@/lib/voice/extract";
import { autoLearnVoice } from "@/lib/voice/history";

/** `{mode:"auto"}` learns from the user's sent Buffer posts; anything else is manual input (samples, interview or preset). */
export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in with Buffer first" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  if (body?.mode === "auto") {
    try {
      return NextResponse.json(await autoLearnVoice(userId));
    } catch (e) {
      if (e instanceof BudgetError || e instanceof RateLimitError) {
        return NextResponse.json({ error: `Buffer is busy right now. Try again in ${e.retryAfter}s, or paste a few posts instead.` }, { status: 429 });
      }
      console.error("Reading Buffer history failed", e);
      return NextResponse.json({ error: "Could not read your Buffer posts. Paste a few instead." }, { status: 502 });
    }
  }

  try {
    const profiles = await extractVoice(userId, body ?? {});
    return NextResponse.json({ profiles });
  } catch (e) {
    if (e instanceof VoiceInputError) return NextResponse.json({ error: e.message }, { status: 400 });
    console.error("Voice extraction failed", e);
    return NextResponse.json({ error: "Could not learn your writing style. Try again or start from a preset." }, { status: 500 });
  }
}
