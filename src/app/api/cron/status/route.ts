import { desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, changeCards, drafts, events, projects } from "@/db/schema";

export const dynamic = "force-dynamic";

// Operator check of the pipeline (events -> cards -> drafts -> AI calls), behind the cron secret. Excludes demo data.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const [eventCounts, recentEvents, recentCards, draftCounts, recentAi, projectRows] = await Promise.all([
    db
      .select({ repo: events.repoFullName, total: sql<number>`count(*)::int`, unprocessed: sql<number>`count(*) filter (where ${events.processedAt} is null)::int` })
      .from(events)
      .groupBy(events.repoFullName),
    db
      .select({ repo: events.repoFullName, kind: events.kind, ref: events.ref, occurredAt: events.occurredAt, processedAt: events.processedAt })
      .from(events)
      .orderBy(desc(events.occurredAt))
      .limit(10),
    db
      .select({ repo: changeCards.repoFullName, what: changeCards.what, significance: changeCards.significance, whyInferred: changeCards.whyInferred, openQuestion: changeCards.openQuestion, occurredAt: changeCards.occurredAt })
      .from(changeCards)
      .orderBy(desc(changeCards.occurredAt))
      .limit(10),
    db
      .select({ project: projects.name, status: drafts.status, total: sql<number>`count(*)::int` })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .where(eq(projects.isDemo, false))
      .groupBy(projects.name, drafts.status),
    db
      .select({ at: aiUsage.createdAt, purpose: aiUsage.purpose, model: aiUsage.model, status: aiUsage.status, estCostUsd: aiUsage.estCostUsd, costUsd: aiUsage.costUsd, inputTokens: aiUsage.inputTokens, outputTokens: aiUsage.outputTokens, cacheReadTokens: aiUsage.cacheReadTokens, error: aiUsage.errorMessage })
      .from(aiUsage)
      .where(eq(aiUsage.isDemo, false))
      .orderBy(desc(aiUsage.createdAt))
      .limit(15),
    db
      .select({ name: projects.name, hasBrief: sql<boolean>`${projects.brief} is not null`, briefStatus: projects.briefStatus, lastDigestAt: projects.lastDigestAt, paused: projects.paused })
      .from(projects)
      .where(eq(projects.isDemo, false)),
  ]);

  return Response.json({ projects: projectRows, eventCounts, recentEvents, recentCards, draftCounts, recentAi });
}
