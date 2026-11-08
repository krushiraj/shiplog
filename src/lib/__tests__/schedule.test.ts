import { describe, expect, it } from "vitest";
import { DEFAULTS, type DigestConfig, type InstantRule } from "@/lib/config";
import { isDigestDue, isInstant, selectCards } from "@/lib/schedule";

const TZ = "Asia/Kolkata";
const digest = (over: Partial<DigestConfig> = {}): DigestConfig => ({ ...DEFAULTS.triggers.digest, ...over });
const d = (iso: string) => new Date(iso);

describe("isDigestDue", () => {
  const now = d("2026-11-10T13:05:00Z"); // 18:35 IST, Tuesday

  it("is due after the local slot when the last digest was yesterday", () => {
    expect(isDigestDue(digest(), TZ, d("2026-11-09T13:00:00Z"), now)).toBe(true);
  });

  it("is not due when a digest already went out after today's slot", () => {
    expect(isDigestDue(digest(), TZ, d("2026-11-10T13:01:00Z"), now)).toBe(false);
  });

  it("is not due before the local slot", () => {
    expect(isDigestDue(digest(), TZ, null, d("2026-11-10T12:00:00Z"))).toBe(false);
  });

  it("is due on first run after the slot", () => {
    expect(isDigestDue(digest(), TZ, null, now)).toBe(true);
  });

  it("never fires when off", () => {
    expect(isDigestDue(digest({ every: "off" }), TZ, null, now)).toBe(false);
  });

  it("waits about two days for 2d", () => {
    expect(isDigestDue(digest({ every: "2d" }), TZ, d("2026-11-09T13:00:00Z"), now)).toBe(false);
    expect(isDigestDue(digest({ every: "2d" }), TZ, d("2026-11-08T13:00:00Z"), now)).toBe(true);
    expect(isDigestDue(digest({ every: "2d" }), TZ, null, now)).toBe(true);
  });

  it("only fires on the configured weekday for weekly", () => {
    expect(isDigestDue(digest({ every: "weekly:Tue" }), TZ, d("2026-11-03T13:00:00Z"), now)).toBe(true);
    expect(isDigestDue(digest({ every: "weekly:Wed" }), TZ, d("2026-11-03T13:00:00Z"), now)).toBe(false);
  });

  it("uses the local date, not the UTC date", () => {
    // 2026-11-10T19:00Z is 00:30 IST on Wed 11 Nov: today's slot is still ahead.
    expect(isDigestDue(digest(), TZ, d("2026-11-10T13:05:00Z"), d("2026-11-10T19:00:00Z"))).toBe(false);
    expect(isDigestDue(digest({ every: "weekly:Wed" }), TZ, null, d("2026-11-11T13:00:00Z"))).toBe(true);
  });

  it("handles UTC and DST zones", () => {
    expect(isDigestDue(digest({ at: "09:00" }), "UTC", null, d("2026-11-10T09:00:00Z"))).toBe(true);
    expect(isDigestDue(digest({ at: "09:00" }), "UTC", null, d("2026-11-10T08:59:00Z"))).toBe(false);
    // New York in July is UTC-4: 09:00 local = 13:00Z
    expect(isDigestDue(digest({ at: "09:00" }), "America/New_York", null, d("2026-07-10T12:59:00Z"))).toBe(false);
    expect(isDigestDue(digest({ at: "09:00" }), "America/New_York", null, d("2026-07-10T13:00:00Z"))).toBe(true);
  });
});

describe("selectCards", () => {
  const now = d("2026-11-10T13:00:00Z");
  const card = (id: string, significance: number, daysAgo: number, cancelled = false) => ({
    id,
    significance,
    occurredAt: new Date(now.getTime() - daysAgo * 86_400_000),
    cancelled,
  });

  it("posts when the significance sum meets the threshold", () => {
    const result = selectCards([card("a", 2, 1), card("b", 1, 2)], digest(), now);
    expect(result.post).toBe(true);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });

  it("carries cards forward below the threshold", () => {
    const result = selectCards([card("a", 1, 1), card("b", 1, 2)], digest(), now);
    expect(result).toEqual({ post: false, cards: [card("a", 1, 1), card("b", 1, 2)] });
  });

  it("drops cancelled and stale cards", () => {
    const result = selectCards(
      [card("old", 3, 8), card("gone", 3, 1, true), card("a", 1, 1), card("b", 1, 6.9)],
      digest(),
      now,
    );
    expect(result.post).toBe(false);
    expect(result.cards.map((c) => c.id)).toEqual(["a", "b"]);
  });
});

describe("isInstant", () => {
  const rules: InstantRule[] = ["release.published", { tag: "v*" }, { "pr.merged": { label: "ship-it" } }, { significance: 3 }];
  const low = { significance: 1 };

  it("matches published releases", () => {
    expect(isInstant(rules, { kind: "release", ref: "v0.2.0" }, low)).toBe(true);
  });

  it("matches tags by glob", () => {
    expect(isInstant(rules, { kind: "tag", ref: "v0.2.0" }, low)).toBe(true);
    expect(isInstant(rules, { kind: "tag", ref: "refs/tags/v0.2.0" }, low)).toBe(true);
    expect(isInstant(rules, { kind: "tag", ref: "nightly-1" }, low)).toBe(false);
  });

  it("matches labelled merged PRs", () => {
    expect(isInstant(rules, { kind: "pr_merged", payload: { labels: ["ship-it"] } }, low)).toBe(true);
    expect(isInstant(rules, { kind: "pr_merged", payload: { labels: ["chore"] } }, low)).toBe(false);
  });

  it("matches by significance", () => {
    expect(isInstant(rules, { kind: "commit" }, { significance: 3 })).toBe(true);
  });

  it("returns false when nothing matches", () => {
    expect(isInstant(rules, { kind: "commit" }, { significance: 2 })).toBe(false);
    expect(isInstant(rules, { kind: "issue_closed" }, low)).toBe(false);
    expect(isInstant([], { kind: "release" }, { significance: 3 })).toBe(false);
    expect(isInstant([{ tag: "v*" }], { kind: "release", ref: "v1" }, low)).toBe(false);
  });
});
