import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { BriefSchema } from "@/lib/ai/schemas";
import { getSessionUserId } from "@/lib/session";

const BriefPatch = BriefSchema.partial().strict();

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/** Edits merge into the stored brief; the next compose reads it, so future drafts follow. */
export async function PUT(req: Request, { params }: { params: Promise<{ projectId: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return error("Sign in first", 401);
  const parsed = BriefPatch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  const { projectId } = await params;

  const owned = and(eq(projects.id, projectId), eq(projects.userId, userId));
  const [row] = await db.select({ brief: projects.brief }).from(projects).where(owned);
  if (!row) return error("Project not found", 404);
  const brief = { ...row.brief, ...parsed.data };
  await db.update(projects).set({ brief }).where(owned);
  return NextResponse.json({ ok: true, brief });
}
