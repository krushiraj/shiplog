import { sql } from "drizzle-orm";
import { db } from "@/db";
import { aiUsage, projects } from "@/db/schema";
import type { AiPurpose } from "./pricing";

export type AiCallStatus = "ok" | "retried" | "format_error" | "refused" | "error" | "skipped_budget";
export type AiRefType = "event" | "draft" | "card" | "project";

export type AiUsageRecord = {
  userId: string | null;
  projectId: string | null;
  projectName: string | null;
  purpose: AiPurpose;
  model: string;
  refType: AiRefType | null;
  refId: string | null;
  estInputTokens: number;
  estOutputTokens: number;
  estCostUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
  cacheSavingsUsd: number;
  latencyMs: number;
  attempts: number;
  status: AiCallStatus;
  errorMessage: string | null;
  isDemo: boolean;
};

export type UsageSink = (row: AiUsageRecord) => Promise<void>;

const usd = (n: number) => n.toFixed(6);

export const drizzleUsageSink: UsageSink = async (row) => {
  const projectName =
    row.projectName ?? (row.projectId ? sql`(select ${projects.name} from ${projects} where ${projects.id} = ${row.projectId})` : null);
  await db.insert(aiUsage).values({
    ...row,
    projectName,
    errorMessage: row.errorMessage?.slice(0, 1000) ?? null,
    estCostUsd: usd(row.estCostUsd),
    costUsd: usd(row.costUsd),
    cacheSavingsUsd: usd(row.cacheSavingsUsd),
  });
};
