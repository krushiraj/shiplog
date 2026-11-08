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

/** The UTC instant of `at` (HH:MM) on the local calendar day containing `now`. */
function scheduledInstant(at: string, timeZone: string, now: Date): { instant: Date; weekday: string } {
  const p = localParts(now, timeZone);
  const [hour, minute] = at.split(":").map(Number);
  const wallClock = Date.UTC(p.year, p.month - 1, p.day, hour, minute);
  // Two passes so the offset is the one in effect at the slot, not at `now` (DST).
  let instant = wallClock - offsetMs(now, timeZone);
  instant = wallClock - offsetMs(new Date(instant), timeZone);
  return { instant: new Date(instant), weekday: p.weekday };
}

export function isDigestDue(
  digest: DigestConfig,
  timezone: string,
  lastDigestAt: Date | null,
  now: Date,
): boolean {
  if (digest.every === "off") return false;
  const { instant, weekday } = scheduledInstant(digest.at, timezone, now);
  if (now < instant) return false;
  if (lastDigestAt && lastDigestAt >= instant) return false;
  if (digest.every === "2d" && lastDigestAt && now.getTime() - lastDigestAt.getTime() < 47 * HOUR) return false;
  if (digest.every.startsWith("weekly:") && digest.every.slice("weekly:".length) !== weekday) return false;
  return true;
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
