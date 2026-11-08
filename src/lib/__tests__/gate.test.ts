import { describe, expect, it, vi } from "vitest";

// containsSecret is deliberately trigger-happy: the gate must only block on hard secrets.
vi.mock("@/lib/scrub", () => ({
  containsSecret: () => true,
  containsHardSecret: (text: string) => /ghp_[A-Za-z0-9]{20,}/.test(text),
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

describe("gate review regressions", () => {
  it("counts appended config hashtags toward the length limit", () => {
    const text = "a".repeat(270);
    const x = { ...base, channel: "x" };
    expect(gate(text, x).violations.map((v) => v.kind)).not.toContain("length");
    expect(gate(text, { ...x, hashtags: ["#BuildInPublic"] }).violations.map((v) => v.kind)).toContain("length");
    expect(gate(`${"a".repeat(255)} #BuildInPublic`, { ...x, hashtags: ["BuildInPublic"] }).violations).toEqual([]);
  });

  it("replaces only the delve verb", () => {
    expect(gate("Let's delve deeper into caching.", base).text).toBe("Let's dig deeper into caching.");
    expect(gate("She delves in. He delved. Delving now.", base).text).toBe("She digs in. He dug. Digging now.");
  });

  it("keeps numeric and version ranges as hyphens", () => {
    expect(gate("Pages 10 – 20 changed.", base).text).toBe("Pages 10-20 changed.");
    expect(gate("Upgraded v1.2–v1.3 today.", base).text).toBe("Upgraded v1.2-v1.3 today.");
  });

  it("never touches dashes inside URLs or code spans", () => {
    const t = "See https://example.com/a—b and `x — y` now.";
    expect(gate(t, base).text).toBe(t);
  });

  it("removes 'in today's fast-paced world' with its leading space", () => {
    expect(gate("Built for devs in today's fast-paced world.", base).text).toBe("Built for devs.");
    expect(gate("We ship in today's fast-paced world, and learn.", base).text).toBe("We ship and learn.");
  });

  it("skips oversized and catastrophic never patterns", () => {
    const evil = { kind: "never" as const, rule: "evil", pattern: "(a+)+$" };
    const huge = { kind: "never" as const, rule: "huge", pattern: "a".repeat(201) };
    const start = Date.now();
    const r = gate(`${"a".repeat(40)}!`, { ...base, rules: [evil, huge] });
    expect(Date.now() - start).toBeLessThan(500);
    expect(r.violations).toEqual([]);
  });

  it("counts emoji by grapheme and ignores ©®™", () => {
    expect(gate("Family 👨‍👩‍👧 and ❤️", base).violations).toEqual([]);
    expect(gate("Shiplog© Pro® Max™", base).violations).toEqual([]);
    expect(gate("👨‍👩‍👧 ❤️ 🚀", base).violations.map((v) => v.kind)).toContain("emoji");
  });

  it("does not block posts that only look like assignments", () => {
    expect(gate("Now we cap max_tokens: budget200000", base).blocked).toBe(false);
  });
});
