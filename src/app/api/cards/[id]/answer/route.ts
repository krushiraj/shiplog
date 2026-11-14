import { and, eq } from "drizzle-orm";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { changeCards, projectRepos } from "@/db/schema";
import { answerCard } from "@/lib/answers";
import { getOwnedProject } from "@/lib/projects";
import { getSessionUserId } from "@/lib/session";

type Ctx = { params: Promise<{ id: string }> };

const Body = z.object({ projectId: z.string().uuid(), answer: z.string().trim().min(1).max(1000) });

export async function POST(req: NextRequest, ctx: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Sign in with Buffer first" }, { status: 401 });
  const cardId = (await ctx.params).id;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success || !z.uuid().safeParse(cardId).success) return NextResponse.json({ error: "Write an answer first" }, { status: 400 });

  const project = await getOwnedProject(userId, parsed.data.projectId);
  if (!project) return NextResponse.json({ error: "Project not found" }, { status: 404 });
  const [card] = await db
    .select({ id: changeCards.id })
    .from(changeCards)
    .innerJoin(projectRepos, and(eq(projectRepos.repoFullName, changeCards.repoFullName), eq(projectRepos.projectId, project.id)))
    .where(eq(changeCards.id, cardId))
    .limit(1);
  if (!card) return NextResponse.json({ error: "That change is not part of this project" }, { status: 404 });

  await answerCard(project.id, cardId, parsed.data.answer);
  return NextResponse.json({ ok: true });
}
