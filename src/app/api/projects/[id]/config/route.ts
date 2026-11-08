import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { projects, users } from "@/db/schema";
import type { PartialConfig } from "@/lib/config";
import { applyConfigPatch } from "@/lib/config-overrides";
import { getSessionUserId } from "@/lib/session";

const Body = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  paused: z.boolean().optional(),
  config: z.record(z.string(), z.unknown()).optional(),
});

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

/** Saves project settings. Only values that differ from the user's defaults are stored on the project. */
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return error("Sign in first", 401);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error("Send {name?, paused?, config?}", 400);
  const { id } = await params;

  const [row] = await db
    .select({ config: projects.config, defaults: users.defaults })
    .from(projects)
    .innerJoin(users, eq(users.id, projects.userId))
    .where(and(eq(projects.id, id), eq(projects.userId, userId)));
  if (!row) return error("Project not found", 404);

  const result = applyConfigPatch(
    { user: row.defaults as PartialConfig, project: row.config as PartialConfig },
    parsed.data.config ?? {},
  );
  if (!result.ok) return error(result.issues.join("; "), 400);

  const { name, paused } = parsed.data;
  await db
    .update(projects)
    .set({ config: result.overrides as Record<string, unknown>, ...(name && { name }), ...(paused !== undefined && { paused }) })
    .where(eq(projects.id, id));
  return NextResponse.json({ ok: true, config: result.config, overrides: result.overrides });
}
