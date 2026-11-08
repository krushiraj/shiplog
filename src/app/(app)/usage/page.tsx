import type { ReactNode } from "react";
import { Chip, type ChipColor } from "@/components/base/badges/chip";
import { PageHeader } from "@/components/shell/PageHeader";
import { loadUsage, type UsageRow, type UsageTotals } from "@/lib/usage";
import { requireUserId } from "@/lib/views";

export const dynamic = "force-dynamic";

const usd = (n: number | null) => (n === null ? "–" : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(4)}`);
const num = (n: number) => n.toLocaleString("en-US");
const pct = (n: number | null) => (n === null ? "–" : `${Math.round(n * 100)}%`);
const times = (n: number | null) => (n === null ? "–" : `${n.toFixed(2)}×`);
const when = (d: Date) =>
  d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

const STATUS: Record<string, { label: string; color: ChipColor }> = {
  ok: { label: "OK", color: "lime" },
  retried: { label: "Retried", color: "cyan" },
  format_error: { label: "Bad JSON", color: "yellow" },
  refused: { label: "Refused", color: "orange" },
  error: { label: "Error", color: "rose" },
  skipped_budget: { label: "Over budget", color: "gray" },
};

function Tile({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-3xl border border-border-button-default bg-background-primary-default p-5">
      <span className="text-caption-1-medium text-text-tertiary">{label}</span>
      <span className="text-title-2-semibold tabular-nums text-text-primary">{value}</span>
      {hint && <span className="text-caption-1-regular text-text-secondary">{hint}</span>}
    </div>
  );
}

function Panel({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return (
    <section className="flex flex-col rounded-3xl border border-border-table bg-background-primary-default pt-4">
      <div className="flex flex-col gap-0.5 px-4 pb-3">
        <h2 className="text-headline-semibold text-text-primary">{title}</h2>
        {description && <p className="text-body-2-regular text-text-secondary">{description}</p>}
      </div>
      <div className="w-full overflow-x-auto">{children}</div>
    </section>
  );
}

const tokens = (t: Pick<UsageTotals, "inputTokens" | "outputTokens" | "cacheReadTokens" | "cacheWriteTokens">) =>
  `${num(t.inputTokens)} in · ${num(t.outputTokens)} out · ${num(t.cacheReadTokens)} cached`;

function WindowsTable({ windows }: { windows: Record<string, UsageTotals> }) {
  const labels: Record<string, string> = { today: "Today (UTC)", d7: "Last 7 days", d30: "Last 30 days", all: "All time" };
  return (
    <table className="bui-table bui-table-sm">
      <thead>
        <tr>
          <th>Window</th>
          <th>Calls</th>
          <th>Cost</th>
          <th>Estimated</th>
          <th>Input</th>
          <th>Output</th>
          <th>Cache read</th>
          <th>Cache write</th>
          <th>Cache saved</th>
        </tr>
      </thead>
      <tbody>
        {Object.entries(windows).map(([key, t]) => (
          <tr key={key}>
            <td>{labels[key]}</td>
            <td className="tabular-nums">{num(t.calls)}{t.skipped ? ` (${t.skipped} skipped)` : ""}</td>
            <td className="tabular-nums">{usd(t.costUsd)}</td>
            <td className="tabular-nums text-text-secondary">{usd(t.estCostUsd)}</td>
            <td className="tabular-nums">{num(t.inputTokens)}</td>
            <td className="tabular-nums">{num(t.outputTokens)}</td>
            <td className="tabular-nums">{num(t.cacheReadTokens)}</td>
            <td className="tabular-nums">{num(t.cacheWriteTokens)}</td>
            <td className="tabular-nums">{usd(t.cacheSavingsUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecentTable({ rows }: { rows: UsageRow[] }) {
  return (
    <table className="bui-table bui-table-sm">
      <thead>
        <tr>
          <th>When (UTC)</th>
          <th>Purpose</th>
          <th>Model</th>
          <th>Tokens est → actual</th>
          <th>Cost est → actual</th>
          <th>Latency</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => {
          const status = STATUS[r.status] ?? { label: r.status, color: "neutral" as const };
          return (
            <tr key={r.id}>
              <td className="whitespace-nowrap tabular-nums text-text-secondary">{when(r.createdAt)}</td>
              <td>
                <span className="flex flex-col">
                  <span>{r.purpose}</span>
                  {r.projectName && <span className="text-caption-1-regular text-text-tertiary">{r.projectName}</span>}
                </span>
              </td>
              <td className="font-code whitespace-nowrap text-text-secondary">{r.model}</td>
              <td className="whitespace-nowrap tabular-nums">
                {num(r.estInputTokens)}/{num(r.estOutputTokens)} → {num(r.inputTokens + r.cacheReadTokens + r.cacheWriteTokens)}/{num(r.outputTokens)}
              </td>
              <td className="whitespace-nowrap tabular-nums">
                {usd(r.estCostUsd)} → {usd(r.costUsd)}
              </td>
              <td className="tabular-nums">{r.attempts ? `${(r.latencyMs / 1000).toFixed(1)}s` : "–"}</td>
              <td>
                <span title={r.errorMessage ?? undefined}>
                  <Chip color={status.color}>
                    {status.label}
                    {r.attempts > 1 ? ` ×${r.attempts}` : ""}
                  </Chip>
                </span>
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

export default async function UsagePage() {
  const userId = await requireUserId();
  const u = await loadUsage(userId);
  const { budget } = u;

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
      <PageHeader
        title="Usage"
        description="Every AI call Shiplog makes for you: what it was for, the estimate before the call, and what it actually cost."
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Tile
          label={budget.scope === "demo" ? "Demo allowance" : "Today's budget"}
          value={`${usd(budget.spentUsd)} of ${usd(budget.limitUsd)}`}
          hint={`${usd(budget.remainingUsd)} left${budget.scope === "today" ? ", resets at midnight UTC" : ""}`}
        />
        <Tile label="Last 30 days" value={usd(u.windows.d30.costUsd)} hint={`${num(u.windows.d30.calls)} calls · ${tokens(u.windows.d30)}`} />
        <Tile label="Cache hit ratio" value={pct(u.cacheHitRatio)} hint={`${usd(u.windows.all.cacheSavingsUsd)} saved all time`} />
        <Tile label="Unit cost" value={`${usd(u.costPerPostedDraft)} / post`} hint={`${usd(u.costPerCard)} per change card`} />
      </div>

      <Panel title="Spend over time">
        <WindowsTable windows={u.windows} />
      </Panel>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="By purpose" description="Accuracy is actual cost over the estimate for calls that ran; above 1× means estimates run low.">
          <table className="bui-table bui-table-sm">
            <thead>
              <tr>
                <th>Purpose</th>
                <th>Calls</th>
                <th>Cost</th>
                <th>Accuracy</th>
                <th>In / out</th>
              </tr>
            </thead>
            <tbody>
              {u.byPurpose.map((p) => (
                <tr key={p.purpose}>
                  <td>{p.purpose}</td>
                  <td className="tabular-nums">{num(p.calls)}</td>
                  <td className="tabular-nums">{usd(p.costUsd)}</td>
                  <td className="tabular-nums">{times(p.accuracy)}</td>
                  <td className="tabular-nums text-text-secondary">
                    {times(p.inputAccuracy)} / {times(p.outputAccuracy)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>

        <Panel title="By project">
          <table className="bui-table bui-table-sm">
            <thead>
              <tr>
                <th>Project</th>
                <th>Calls</th>
                <th>Cost</th>
                <th>Tokens</th>
              </tr>
            </thead>
            <tbody>
              {u.byProject.map((p) => (
                <tr key={p.projectId ?? "none"}>
                  <td>{p.projectName}</td>
                  <td className="tabular-nums">{num(p.calls)}</td>
                  <td className="tabular-nums">{usd(p.costUsd)}</td>
                  <td className="tabular-nums text-text-secondary">{tokens(p)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      </div>

      <Panel title="Recent calls" description={`The last ${u.recent.length} calls. Tokens show input/output; actual input includes cached tokens.`}>
        {u.recent.length ? (
          <RecentTable rows={u.recent} />
        ) : (
          <p className="px-4 pb-5 text-body-regular text-text-secondary">No AI calls yet. They show up here as soon as Shiplog reads a change or writes a draft.</p>
        )}
      </Panel>
    </div>
  );
}
