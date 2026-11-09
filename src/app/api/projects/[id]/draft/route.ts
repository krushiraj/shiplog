import { NextResponse, type NextRequest } from "next/server";
import { AiBudgetError } from "@/lib/ai/budget";
import { getOwnedProject } from "@/lib/projects";
import { getSessionUserId } from "@/lib/session";
import { draftNow } from "@/lib/tick";

type Ctx = { params: Promise<{ id: string }> };

export const maxDuration = 120;

export async function POST(_req: NextRequest, ctx: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in with Buffer first" }, { status: 401 });
  const project = await getOwnedProject(userId, (await ctx.params).id);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  try {
    const draftId = await draftNow(project.id);
    if (!draftId) {
      return NextResponse.json({ error: "Nothing new to write about. Every recent change is already in a draft." }, { status: 409 });
    }
    return NextResponse.json({ draftId });
  } catch (e) {
    if (e instanceof AiBudgetError) return NextResponse.json({ error: e.message }, { status: 429 });
    console.error("Draft now failed", e);
    return NextResponse.json({ error: "Couldn't write the draft. Try again in a minute." }, { status: 500 });
  }
}
