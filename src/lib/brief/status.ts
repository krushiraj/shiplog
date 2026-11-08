export type BriefBuildStatus = {
  step: string;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  partial?: boolean;
  stats: { files: number; cachedSummaries: number; newSummaries: number; estTokens: number };
};

const STALE_MS = 10 * 60_000;

/** The step a persisted status implies; a build that stopped reporting long ago (crashed instance) counts as failed. */
export function persistedStep(status: Partial<BriefBuildStatus> | null | undefined, now = Date.now()): string | null {
  if (!status?.step) return null;
  if (status.step === "Done" || status.step === "Failed") return status.step;
  const started = status.startedAt ? Date.parse(status.startedAt) : NaN;
  return Number.isFinite(started) && now - started > STALE_MS ? "Failed" : status.step;
}
