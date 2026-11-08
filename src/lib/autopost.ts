import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { drafts, projects, users } from "@/db/schema";
import { publishDraft as realPublish } from "@/lib/buffer/post";
import type { DraftGate } from "@/lib/compose";
import { resolveConfig, type PartialConfig } from "@/lib/config";

export type AutoContext = {
  status: string;
  gate: Partial<DraftGate> | null;
  userDefaults: Record<string, unknown>;
  projectConfig: Record<string, unknown>;
};

export interface AutoStore {
  load(draftId: string): Promise<AutoContext | null>;
  /** Records why auto mode left the draft in the inbox (shown on the card). */
  noteHeld(draftId: string, reason: string): Promise<void>;
}

export type AutoDeps = { store?: AutoStore; publish?: typeof realPublish };

export type AutoOutcome = { action: "published" | "saved_to_draft" | "held" | "none"; reason?: string };

export function autoHoldReason(gate: Partial<DraftGate> | null, minScore: number, rulesPassed: boolean): string | null {
  if (!gate?.channels) return "no gate result";
  if (gate.fallback) return "AI fallback draft";
  const keys = Object.keys(gate.channels);
  for (const key of keys) {
    const g = gate.channels[key];
    if (g.blocked) return `${key}: possible secret`;
    if (rulesPassed && g.violations.length) return `${key}: ${g.violations[0].detail}`;
    const score = gate.voiceScore?.[key];
    if (score === undefined) return `${key}: no voice score`;
    if (score < minScore) return `${key}: voice score ${score.toFixed(2)} < ${minScore}`;
  }
  return keys.length ? null : "no channels";
}

export async function maybeAutoPublish(draftId: string, deps: AutoDeps = {}): Promise<AutoOutcome> {
  const store = deps.store ?? drizzleAutoStore;
  const publish = deps.publish ?? realPublish;
  const ctx = await store.load(draftId);
  if (!ctx || ctx.status !== "pending") return { action: "none" };
  const config = resolveConfig(ctx.userDefaults as PartialConfig, ctx.projectConfig as PartialConfig);
  const { mode, auto_requires } = config.review;

  if (mode === "draft") {
    await publish(draftId, "next_best_slot", { saveToDraft: true });
    return { action: "saved_to_draft" };
  }
  if (mode !== "auto") return { action: "none" };

  const reason = autoHoldReason(ctx.gate, auto_requires.voice_score, auto_requires.rules_passed);
  if (reason) {
    await store.noteHeld(draftId, reason);
    return { action: "held", reason };
  }
  await publish(draftId, config.posting.when === "now" ? "now" : "next_best_slot");
  return { action: "published" };
}

export const drizzleAutoStore: AutoStore = {
  async load(draftId) {
    const [row] = await db
      .select({ status: drafts.status, gate: drafts.gate, userDefaults: users.defaults, projectConfig: projects.config })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(drafts.id, draftId));
    return row ? { ...row, gate: row.gate as Partial<DraftGate> | null } : null;
  },
  async noteHeld(draftId, reason) {
    await db
      .update(drafts)
      .set({ gate: sql`coalesce(${drafts.gate}, '{}'::jsonb) || jsonb_build_object('autoHeld', ${reason}::text)` })
      .where(eq(drafts.id, draftId));
  },
};
