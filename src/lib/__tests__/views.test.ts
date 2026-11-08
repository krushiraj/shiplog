import { describe, expect, it } from "vitest";
import { DEFAULTS } from "@/lib/config";
import { cadenceLabel, streakDays, toBriefView, toCardView, toDraftView, toPostRow, toRuleView } from "@/lib/views";

const card = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  eventId: "e1",
  repoFullName: "kr/shiplog",
  what: "Added a scheduler",
  why: "Digests were manual",
  whyInferred: true,
  how: null,
  impact: null,
  significance: 2,
  openQuestion: null,
  answer: null,
  cancelled: false,
  occurredAt: new Date("2026-11-08T10:00:00Z"),
  ...over,
});

const draft = (over: Record<string, unknown> = {}) => ({
  id: "d1",
  projectId: "p1",
  trigger: "digest",
  cardIds: ["c1"],
  variants: { x: "AI x", linkedin: "AI li", bluesky: "AI bsky" },
  finalText: { x: "Edited x" },
  gate: {
    channels: { x: { fixed: ["replaced em/en dashes"], violations: [], blocked: false } },
    targets: [{ channelId: "ch_x", key: "x" }],
    voiceScore: { x: 0.9, linkedin: 0.6 },
    suggestions: { x: ["shorter", "drop the emoji"], linkedin: ["lead with the number"] },
    suggestionDecisions: { "x:1": false },
  },
  status: "pending",
  rejectReason: null,
  scheduledFor: null,
  createdAt: new Date("2026-11-08T12:00:00Z"),
  ...over,
});

describe("toCardView", () => {
  it("formats refs and links per event kind", () => {
    const sha = "abcdef1234567890";
    expect(toCardView(card(), { kind: "commit", ref: sha, payload: { url: "https://x/commit" } })).toMatchObject({
      ref: "abcdef1",
      kind: "commit",
      url: "https://x/commit",
    });
    expect(toCardView(card(), { kind: "pr_merged", ref: "42", payload: {} })).toMatchObject({
      ref: "#42",
      url: "https://github.com/kr/shiplog/pull/42",
    });
    expect(toCardView(card(), { kind: "revert", ref: sha, payload: {} }).kind).toBe("commit");
  });

  it("prefers the author's answer over an inferred why", () => {
    const v = toCardView(card({ answer: "Users asked for it" }), null);
    expect(v).toMatchObject({ why: "Users asked for it", whyInferred: false, url: "https://github.com/kr/shiplog" });
  });
});

describe("toDraftView", () => {
  const cards = [toCardView(card({ openQuestion: "Why now?" }), { kind: "commit", ref: "abc1234", payload: {} })];
  const raw = [card({ openQuestion: "Why now?" })];

  it("shows edited text, known channels only, and gate info", () => {
    const v = toDraftView({ draft: draft(), project: { id: "p1", name: "Shiplog" }, cards, rawCards: raw, config: DEFAULTS });
    expect(v.variants).toEqual({ x: "Edited x", linkedin: "AI li" });
    expect(v.gate.drift).toBeCloseTo(0.4);
    expect(v.gate.fixed).toEqual(["replaced em/en dashes"]);
    expect(v.gate.suggestions).toEqual([
      { id: "x:0", text: "shorter" },
      { id: "linkedin:0", text: "lead with the number" },
    ]);
    expect(v.openQuestion).toEqual({ cardId: "c1", question: "Why now?" });
    expect(v.trigger).toEqual({ kind: "digest", label: "Digest · 1 change" });
    expect(v.slot.label).toBe("Next free Buffer slot");
  });

  it("hides answered questions and labels releases", () => {
    const answered = [card({ openQuestion: "Why now?", answer: "Because" })];
    const rel = [toCardView(card(), { kind: "release", ref: "v1.0.0", payload: {} })];
    const v = toDraftView({ draft: draft({ trigger: "instant:release" }), project: { id: "p1", name: "S" }, cards: rel, rawCards: answered, config: DEFAULTS });
    expect(v.openQuestion).toBeNull();
    expect(v.trigger).toEqual({ kind: "release", label: "Release v1.0.0" });
  });
});

describe("toPostRow", () => {
  it("maps a post to its channel text and Buffer link", () => {
    const row = toPostRow({
      post: { id: "po1", channelId: "ch_x", bufferPostId: "bp1", status: "sent", createdAt: new Date("2026-11-08T13:00:00Z") },
      draft: draft(),
      projectName: "Shiplog",
      sources: [{ ref: "abc1234", url: "u" }],
    });
    expect(row).toMatchObject({ channel: "x", excerpt: "Edited x", status: "sent", bufferUrl: "https://publish.buffer.com", at: "2026-11-08T13:00:00.000Z" });
  });

  it("has no Buffer link for demo posts and skips unknown channels", () => {
    const base = { id: "po1", channelId: "ch_x", bufferPostId: "demo_123", status: "queued", createdAt: new Date() };
    expect(toPostRow({ post: base, draft: draft(), projectName: "S", sources: [] })?.bufferUrl).toBeNull();
    expect(toPostRow({ post: { ...base, channelId: "nope" }, draft: draft(), projectName: "S", sources: [] })).toBeNull();
  });
});

describe("small mappers", () => {
  it("toRuleView names the source", () => {
    const r = { id: "r1", kind: "never", rule: "delve", register: null, sightings: 2, active: true, sourceDraftId: "12345678-aaaa" };
    expect(toRuleView(r).source).toBe("Learned from draft 12345678");
    expect(toRuleView({ ...r, sourceDraftId: null }).source).toBe("Added by you");
  });

  it("toBriefView tolerates missing fields", () => {
    expect(toBriefView({ pitch: "P", facts: ["f"] })).toMatchObject({ pitch: "P", audience: "", stack: [], facts: ["f"] });
    expect(toBriefView(null).pitch).toBe("");
  });

  it("cadenceLabel describes the digest", () => {
    expect(cadenceLabel(DEFAULTS)).toBe("Daily digest at 18:30");
    expect(cadenceLabel({ ...DEFAULTS, triggers: { ...DEFAULTS.triggers, digest: { ...DEFAULTS.triggers.digest, every: "off" } } })).toBe("Releases only");
  });

  it("streakDays counts consecutive days with changes ending today or yesterday", () => {
    const now = new Date("2026-11-08T12:00:00Z");
    const d = (s: string) => new Date(s);
    expect(streakDays([d("2026-11-08T01:00:00Z"), d("2026-11-07T05:00:00Z"), d("2026-11-06T05:00:00Z"), d("2026-11-04T05:00:00Z")], now)).toBe(3);
    expect(streakDays([d("2026-11-07T05:00:00Z")], now)).toBe(1);
    expect(streakDays([d("2026-11-05T05:00:00Z")], now)).toBe(0);
  });
});

describe("demo repos", () => {
  it("shows the real repo name and link for demo cards", () => {
    const v = toCardView(card({ repoFullName: "krushiraj/shiplog#demo-1a2b3c4d" }), { kind: "pr_merged", ref: "7", payload: {} });
    expect(v).toMatchObject({ repo: "krushiraj/shiplog", url: "https://github.com/krushiraj/shiplog/pull/7" });
  });
});
