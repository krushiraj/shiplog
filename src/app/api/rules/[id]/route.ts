import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { voiceRules } from "@/db/schema";
import { getSessionUserId } from "@/lib/session";
import { acceptRule, undoRule } from "@/lib/voice/learn-server";

const Patch = z.union([z.object({ active: z.boolean() }), z.object({ undo: z.literal(true) })]);

type Ctx = { params: Promise<{ id: string }> };
const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

export async function PATCH(req: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) return error("Sign in first", 401);
  const parsed = Patch.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Send {active: boolean} or {undo: true}", 400);
  const { id } = await params;
  const body = parsed.data;

  let ok: boolean;
  if ("undo" in body) ok = await undoRule(userId, id);
  else if (body.active) ok = await acceptRule(userId, id);
  else {
    const rows = await db
      .update(voiceRules)
      .set({ active: false })
      .where(and(eq(voiceRules.id, id), eq(voiceRules.userId, userId)))
      .returning({ id: voiceRules.id });
    ok = rows.length > 0;
  }
  return ok ? NextResponse.json({ ok: true }) : error("Rule not found", 404);
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const userId = await getSessionUserId();
  if (!userId) return error("Sign in first", 401);
  const { id } = await params;
  const rows = await db
    .delete(voiceRules)
    .where(and(eq(voiceRules.id, id), eq(voiceRules.userId, userId)))
    .returning({ id: voiceRules.id });
  return rows.length ? NextResponse.json({ ok: true }) : error("Rule not found", 404);
}
