export const LIMITS = { "15m": 100, "24h": 250, "30d": 3000 } as const;

export type BudgetWindow = keyof typeof LIMITS;

const pad = (n: number) => String(n).padStart(2, "0");

// 30d is approximated by the calendar month.
export function windowsFor(d: Date): string[] {
  const month = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`;
  const day = `${month}-${pad(d.getUTCDate())}`;
  const quarter = Math.floor(d.getUTCMinutes() / 15) * 15;
  return [`15m:${day}T${pad(d.getUTCHours())}:${pad(quarter)}`, `24h:${day}`, `30d:${month}`];
}

export function shouldBackOff(usage: Record<BudgetWindow, number>, ratio = 0.8): boolean {
  return (Object.keys(LIMITS) as BudgetWindow[]).some((k) => usage[k] >= LIMITS[k] * ratio);
}
