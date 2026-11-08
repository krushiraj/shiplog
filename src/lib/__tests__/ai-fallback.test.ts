import { describe, expect, it } from "vitest";
import { fallbackDraft } from "../ai/fallback";

const cards = [
  { what: "Added a scoring step to rank changes", significance: 2 },
  { what: "Fixed the webhook retry loop", significance: 1 },
  { what: "Bumped dependencies", significance: 0 },
];

describe("fallbackDraft", () => {
  it("builds a plain template from card whats", () => {
    const out = fallbackDraft(cards, "linkedin", 3000, "Shiplog");
    expect(out.startsWith("Today in Shiplog:")).toBe(true);
    expect(out).toContain("• Added a scoring step to rank changes");
    expect(out).toContain("• Fixed the webhook retry loop");
  });

  it("orders by significance and is deterministic", () => {
    const a = fallbackDraft([...cards].reverse(), "x", 280, "Shiplog");
    expect(a).toBe(fallbackDraft(cards, "x", 280, "Shiplog"));
    expect(a.indexOf("scoring")).toBeLessThan(a.indexOf("webhook"));
  });

  it("respects the limit by dropping bullets, then trimming", () => {
    const out = fallbackDraft(cards, "x", 70, "Shiplog");
    expect(out.length).toBeLessThanOrEqual(70);
    expect(out.startsWith("Today in Shiplog:")).toBe(true);
    const tiny = fallbackDraft([{ what: "x".repeat(500), significance: 3 }], "x", 40, "Shiplog");
    expect(tiny.length).toBeLessThanOrEqual(40);
  });

  it("handles no cards", () => {
    expect(fallbackDraft([], "x", 280, "Shiplog")).toBe("Today in Shiplog: small fixes and upkeep.");
  });
});
