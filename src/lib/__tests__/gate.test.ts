import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/scrub", () => ({
  containsSecret: (text: string) => /ghp_[A-Za-z0-9]{20,}/.test(text),
  scrub: (text: string) => text,
}));

import { gate } from "@/lib/gate";

const base = { channel: "linkedin", rules: [], hashtags: [] };

describe("gate silent fixes", () => {
  it("replaces em dashes used as punctuation", () => {
    const r = gate("We shipped scoring — it was hard.", base);
    expect(r.text).toBe("We shipped scoring, it was hard.");
    expect(r.text).not.toMatch(/[—–]/);
    expect(r.fixed.length).toBeGreaterThan(0);
  });

  it("does not leave double commas or spaces around dashes", () => {
    const r = gate("Fast, — really fast–and cheap.", base);
    expect(r.text).toBe("Fast, really fast, and cheap.");
  });

  it("turns a dash before a capital into a sentence break", () => {
    const r = gate("Shipped it — Now on to billing.", base);
    expect(r.text).toBe("Shipped it. Now on to billing.");
  });

  it("keeps en dashes in number ranges", () => {
    expect(gate("Pages 3–5 changed.", base).text).toBe("Pages 3–5 changed.");
  });

  it("replaces delve with dig into", () => {
    const r = gate("Let me delve into the parser. Delve into it.", base);
    expect(r.text).toBe("Let me dig into the parser. Dig into it.");
    expect(r.fixed.some((f) => /delve/i.test(f))).toBe(true);
  });

  it("removes filler phrases and fixes capitalization", () => {
    const r = gate("In today's fast-paced world, shipping matters. Let's dive in.\n\n\n\nIt's a game-changer.  ", base);
    expect(r.text).toBe("Shipping matters.\n\nIt's a big change.");
  });
});

describe("gate violations", () => {
  it("flags never rules by phrase, case-insensitive", () => {
    const r = gate("This is a Huge Milestone for us.", {
      ...base,
      rules: [{ kind: "never", rule: "huge milestone" }],
    });
    expect(r.violations).toContainEqual(
      expect.objectContaining({ kind: "never", rule: "huge milestone" }),
    );
    expect(r.text).toContain("Huge Milestone");
  });

  it("flags never rules by regex pattern", () => {
    const r = gate("We are SO pumped!!!", {
      ...base,
      rules: [{ kind: "never", rule: "No triple exclamation", pattern: "!{3,}" }],
    });
    expect(r.violations.map((v) => v.kind)).toContain("never");
  });

  it("ignores prefer and format rules for violations", () => {
    const r = gate("hello", { ...base, rules: [{ kind: "prefer", rule: "hello" }] });
    expect(r.violations).toEqual([]);
  });

  it("flags x posts over 280 chars", () => {
    const r = gate("a".repeat(281), { ...base, channel: "x" });
    expect(r.violations.map((v) => v.kind)).toContain("length");
  });

  it("allows long linkedin posts", () => {
    const r = gate("word ".repeat(500), base);
    expect(r.violations.map((v) => v.kind)).not.toContain("length");
  });

  it("uses 3000 for unknown channels", () => {
    expect(gate("a".repeat(3000), { ...base, channel: "smoke-signal" }).violations).toEqual([]);
    expect(gate("a".repeat(3001), { ...base, channel: "smoke-signal" }).violations.map((v) => v.kind)).toContain("length");
  });

  it("caps hashtags", () => {
    const text = "Shipped. #a #b #c #d";
    expect(gate(text, base).violations.map((v) => v.kind)).toContain("hashtags");
    expect(gate(text, { ...base, maxHashtags: 4 }).violations).toEqual([]);
  });

  it("caps emoji", () => {
    const text = "Shipped 🚀🎉🔥";
    expect(gate(text, base).violations.map((v) => v.kind)).toContain("emoji");
    expect(gate(text, { ...base, maxEmoji: 3 }).violations).toEqual([]);
  });

  it("flags the fatal not-X-it's-Y construction", () => {
    for (const t of [
      "This isn't a refactor, it's a rewrite.",
      "It's not just a feature, it's a platform.",
    ]) {
      expect(gate(t, base).violations.map((v) => v.kind)).toContain("ai_pattern");
    }
  });

  it("flags excited to announce and thrilled to", () => {
    expect(gate("Excited to announce v2.", base).violations.map((v) => v.kind)).toContain("ai_pattern");
    expect(gate("Thrilled to share this.", base).violations.map((v) => v.kind)).toContain("ai_pattern");
  });

  it("clean text has no violations", () => {
    const r = gate("Shipped scoring today. #buildinpublic", base);
    expect(r.violations).toEqual([]);
    expect(r.fixed).toEqual([]);
    expect(r.blocked).toBe(false);
  });

  it("blocks text containing a secret", () => {
    const r = gate("token ghp_abcdefghijklmnopqrstuvwxyz0123", base);
    expect(r.blocked).toBe(true);
  });
});
