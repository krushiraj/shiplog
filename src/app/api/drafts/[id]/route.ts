import { and, eq, sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/db";
import { drafts, projects } from "@/db/schema";
import { answerCard } from "@/lib/answers";
import { publishDraft } from "@/lib/buffer/post";
import { compose } from "@/lib/compose";
import { DemoLimitError, withDemoBudget } from "@/lib/demo";
import { getSessionUserId } from "@/lib/session";
import { REJECT_REASONS } from "@/lib/ui-types";
import { addExamples, editedChannels, learnFromEdit, learnFromReject, type LearnedRule } from "@/lib/voice/learn-server";

const When = z.union([z.enum(["now", "next_best_slot"]), z.object({ at: z.iso.datetime() })]);
const Texts = z.record(z.string(), z.string().max(20_000));

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("edit"), channel: z.string().min(1), text: z.string().max(20_000) }),
  z.object({ action: z.literal("approve"), when: When, texts: Texts.optional(), channels: z.array(z.string()).optional() }),
  z.object({ action: z.literal("reject"), reason: z.string().max(300).optional().default("") }),
  z.object({ action: z.literal("snooze") }),
  z.object({ action: z.literal("regenerate"), nudge: z.string().max(500).optional() }),
  z.object({ action: z.literal("answer"), cardId: z.string().uuid(), answer: z.string().trim().min(1).max(1000), rewrite: z.boolean().optional() }),
  z.object({ action: z.literal("suggestion"), channel: z.string().min(1), index: z.number().int().min(0), accept: z.boolean() }),
]);

type Draft = typeof drafts.$inferSelect;

const error = (message: string, status: number) => NextResponse.json({ error: message }, { status });

async function ownedDraft(userId: string, draftId: string) {
  const [row] = await db
    .select({ draft: drafts, isDemo: projects.isDemo, brief: projects.brief })
    .from(drafts)
    .innerJoin(projects, eq(projects.id, drafts.projectId))
    .where(and(eq(drafts.id, draftId), eq(projects.userId, userId)));
  return row ?? null;
}

/** Keeps only the channels whose text differs from the AI variant. */
function diffTexts(draft: Draft, texts: Record<string, string>) {
  const merged = { ...draft.finalText, ...texts };
  return Object.fromEntries(Object.entries(merged).filter(([k, v]) => k in draft.variants && v !== draft.variants[k]));
}

async function recompose(userId: string, draft: Draft, nudge?: string) {
  const { draftId } = await withDemoBudget(userId, () =>
    compose(draft.projectId, draft.cardIds, draft.trigger, { nudge: nudge || null, purpose: "regenerate" }),
  );
  await db.update(drafts).set({ status: "rejected", rejectReason: `superseded by ${draftId}` }).where(eq(drafts.id, draft.id));
  return draftId;
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return error("Sign in first", 401);
  const parsed = Action.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return error(parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  const { id } = await params;
  const row = await ownedDraft(userId, id);
  if (!row) return error("Draft not found", 404);
  const { draft } = row;
  const body = parsed.data;

  const actionable = draft.status === "pending" || (body.action === "approve" && draft.status === "approved");
  if (!actionable && body.action !== "answer") return error(`This draft is already ${draft.status}`, 409);

  try {
    switch (body.action) {
      case "edit": {
        if (!(body.channel in draft.variants)) return error(`No ${body.channel} variant on this draft`, 400);
        const finalText = diffTexts(draft, { [body.channel]: body.text });
        await db.update(drafts).set({ finalText }).where(eq(drafts.id, id));
        return NextResponse.json({ ok: true });
      }

      case "approve": {
        const finalText = diffTexts(draft, body.texts ?? {});
        await db.update(drafts).set({ finalText, status: "approved" }).where(eq(drafts.id, id));
        const when = typeof body.when === "object" ? { at: new Date(body.when.at) } : body.when;
        let result;
        try {
          result = await publishDraft(id, when, { channels: body.channels });
        } catch (e) {
          await db.update(drafts).set({ status: "pending" }).where(eq(drafts.id, id));
          return error(`Could not post: ${(e as Error).message}`, 502);
        }
        let proposals: LearnedRule[] = [];
        try {
          if (editedChannels(draft.variants, finalText).length) proposals = await learnFromEdit(id);
          else await addExamples(id);
        } catch {
          // Learning is best effort; the post already went out.
        }
        const errors = result.results.filter((r) => r.status === "error").map((r) => r.error);
        return NextResponse.json({ status: result.status, errors, proposals, simulated: row.isDemo });
      }

      case "reject": {
        await db.update(drafts).set({ status: "rejected", rejectReason: body.reason || null }).where(eq(drafts.id, id));
        const voiceReason = body.reason.trim() && !(REJECT_REASONS as readonly string[]).includes(body.reason.trim());
        const proposals = voiceReason ? await learnFromReject(id, body.reason).catch(() => []) : [];
        return NextResponse.json({ ok: true, proposals });
      }

      case "snooze":
        // Snoozed drafts do not hold their cards, so the next digest picks them up again.
        await db.update(drafts).set({ status: "snoozed" }).where(eq(drafts.id, id));
        return NextResponse.json({ ok: true });

      case "regenerate":
        return NextResponse.json({ ok: true, draftId: await recompose(userId, draft, body.nudge) });

      case "answer": {
        if (!draft.cardIds.includes(body.cardId)) return error("That change is not part of this draft", 400);
        await answerCard(draft.projectId, body.cardId, body.answer);
        const draftId = body.rewrite && draft.status === "pending" ? await recompose(userId, draft) : null;
        return NextResponse.json({ ok: true, draftId });
      }

      case "suggestion": {
        const key = `${body.channel}:${body.index}`;
        await db
          .update(drafts)
          .set({
            gate: sql`jsonb_set(coalesce(${drafts.gate}, '{}'::jsonb), '{suggestionDecisions}', coalesce(${drafts.gate}->'suggestionDecisions', '{}'::jsonb) || jsonb_build_object(${key}::text, ${body.accept}::boolean))`,
          })
          .where(eq(drafts.id, id));
        return NextResponse.json({ ok: true });
      }
    }
  } catch (e) {
    if (e instanceof DemoLimitError) return error(e.message, 429);
    throw e;
  }
}
