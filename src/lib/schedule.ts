import { parseDuration, type DigestConfig, type InstantRule } from "@/lib/config";

const HOUR = 3_600_000;

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number; weekday: string };

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    weekday: "short",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    weekday: get("weekday"),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = localParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60_000) * 60_000;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * The UTC instant of a local wall-clock time. Tries the offsets in effect on either side of the
 * day: a repeated time (fall-back) takes its first occurrence, a skipped time (spring-forward)
 * takes the later candidate so the slot lands just after the gap.
 */
function wallClockInstant(wallClock: number, timeZone: string): number {
  const candidates = [-14 * HOUR, 14 * HOUR].map((shift) => wallClock - offsetMs(new Date(wallClock + shift), timeZone));
  const valid = candidates.filter((c) => c + offsetMs(new Date(c), timeZone) === wallClock);
  return valid.length ? Math.min(...valid) : Math.max(...candidates);
}

/** The latest eligible slot at or before `now`, and how many local days back it falls. */
function latestSlot(digest: DigestConfig, timeZone: string, now: Date): { slot: number; daysBack: number } | null {
  const p = localParts(now, timeZone);
  const [hour, minute] = digest.at.split(":").map(Number);
  const weekly = digest.every.startsWith("weekly:") ? digest.every.slice("weekly:".length) : null;
  for (let daysBack = 0; daysBack <= 8; daysBack++) {
    const wallClock = Date.UTC(p.year, p.month - 1, p.day - daysBack, hour, minute);
    if (weekly && WEEKDAYS[new Date(wallClock).getUTCDay()] !== weekly) continue;
    const slot = wallClockInstant(wallClock, timeZone);
    if (slot <= now.getTime()) return { slot, daysBack };
  }
  return null;
}

export function isDigestDue(
  digest: DigestConfig,
  timezone: string,
  lastDigestAt: Date | null,
  now: Date,
): boolean {
  if (digest.every === "off") return false;
  const latest = latestSlot(digest, timezone, now);
  if (!latest) return false;
  const sinceSlot = now.getTime() - latest.slot;
  // A slot missed by a day or more is skipped rather than posted late.
  if (sinceSlot >= 24 * HOUR) return false;
  // First run: only today's slot, or one that just passed across midnight.
  if (!lastDigestAt) return latest.daysBack === 0 || sinceSlot < HOUR;
  if (lastDigestAt.getTime() >= latest.slot) return false;
  return digest.every !== "2d" || now.getTime() - lastDigestAt.getTime() >= 47 * HOUR;
}

type SelectableCard = { id: string; significance: number; occurredAt: Date; cancelled: boolean };

export function selectCards<C extends SelectableCard>(
  cards: C[],
  digest: DigestConfig,
  now: Date,
): { post: boolean; cards: C[] } {
  const cutoff = now.getTime() - parseDuration(digest.max_age);
  const live = cards.filter((c) => !c.cancelled && c.occurredAt.getTime() >= cutoff);
  const sum = live.reduce((total, c) => total + c.significance, 0);
  return { post: live.length > 0 && sum >= digest.min_significance_sum, cards: live };
}

export type InstantEvent = {
  kind: "release" | "tag" | "pr_merged" | "commit" | "issue_closed" | (string & {});
  ref?: string;
  payload?: { labels?: string[] };
};

function globToRegExp(glob: string): RegExp {
  const escaped = glob.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`^${escaped.join(".*")}$`);
}

function matchesRule(rule: InstantRule, event: InstantEvent, card: { significance: number }): boolean {
  if (rule === "release.published") return event.kind === "release";
  if ("tag" in rule) {
    const ref = event.ref?.replace(/^refs\/tags\//, "");
    return event.kind === "tag" && ref !== undefined && globToRegExp(rule.tag).test(ref);
  }
  if ("pr.merged" in rule) {
    return event.kind === "pr_merged" && (event.payload?.labels ?? []).includes(rule["pr.merged"].label);
  }
  return card.significance >= rule.significance;
}

export function isInstant(rules: InstantRule[], event: InstantEvent, card: { significance: number }): boolean {
  return rules.some((rule) => matchesRule(rule, event, card));
}
