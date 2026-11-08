import { describe, expect, it } from "vitest";
import { applySighting, diffSignals, isExpired, matchRule, type Rule } from "@/lib/voice/learn";

describe("diffSignals", () => {
  it("captures removed and added word runs", () => {
    const s = diffSignals("Super excited to share that we shipped scoring!", "Shipped scoring.");
    expect(s.removed.join(" ")).toContain("Super excited to share that we");
    expect(s.exclamationDelta).toBe(-1);
    expect(s.lengthDelta).toBe("Shipped scoring.".length - "Super excited to share that we shipped scoring!".length);
  });

  it("ignores pure punctuation and whitespace runs", () => {
    const s = diffSignals("Shipped it!", "Shipped it.");
    expect(s.removed).toEqual([]);
    expect(s.added).toEqual([]);
  });

  it("reports added runs", () => {
    const s = diffSignals("Shipped scoring.", "Shipped scoring for repos.");
    expect(s.added.join(" ")).toContain("for repos");
  });

  it("computes emoji and hashtag deltas", () => {
    const s = diffSignals("Shipped 🚀🎉 #buildinpublic #saas", "Shipped #buildinpublic");
    expect(s.emojiDelta).toBe(-2);
    expect(s.hashtagDelta).toBe(-1);
  });
});

const proposal = { kind: "never", rule: "Avoid 'super excited'", pattern: null };

describe("applySighting", () => {
  const now = new Date("2026-11-08T00:00:00Z");

  it("creates an inactive rule on first sighting", () => {
    const r = applySighting(undefined, proposal, now);
    expect(r).toMatchObject({ ...proposal, sightings: 1, active: false, lastSeenAt: now });
  });

  it("activates on the second sighting", () => {
    const later = new Date("2026-11-09T00:00:00Z");
    const first = applySighting(undefined, proposal, now);
    const second = applySighting(first, proposal, later);
    expect(second).toMatchObject({ sightings: 2, active: true, lastSeenAt: later });
    expect(first.sightings).toBe(1);
  });
});

describe("matchRule", () => {
  const rule = (over: Partial<Rule>): Rule => ({
    kind: "never",
    rule: "x",
    pattern: null,
    sightings: 1,
    active: false,
    lastSeenAt: new Date(),
    ...over,
  });

  it("matches by pattern", () => {
    const r = rule({ rule: "something else", pattern: "super excited" });
    expect(matchRule([r], { kind: "never", rule: "different", pattern: "super excited" })).toBe(r);
  });

  it("matches by rule text ignoring case and trailing punctuation", () => {
    const r = rule({ rule: "Avoid 'super excited'." });
    expect(matchRule([r], { kind: "never", rule: "  avoid 'super excited'" })).toBe(r);
  });

  it("returns undefined when nothing matches", () => {
    expect(matchRule([rule({ rule: "No emoji" })], proposal)).toBeUndefined();
  });
});

describe("isExpired", () => {
  const r: Rule = { ...proposal, sightings: 2, active: true, lastSeenAt: new Date("2026-10-01T00:00:00Z") };

  it("expires after 30 days unseen", () => {
    expect(isExpired(r, new Date("2026-11-08T00:00:00Z"))).toBe(true);
    expect(isExpired(r, new Date("2026-10-20T00:00:00Z"))).toBe(false);
  });

  it("honours a custom window", () => {
    expect(isExpired(r, new Date("2026-10-20T00:00:00Z"), 10)).toBe(true);
  });
});
