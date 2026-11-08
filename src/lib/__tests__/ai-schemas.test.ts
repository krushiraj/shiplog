import { describe, expect, it } from "vitest";
import {
  BriefSchema,
  ChangeCardSchema,
  ComposeSchema,
  FileSummarySchema,
  RuleProposalsSchema,
  VoiceCheckSchema,
  VoiceDnaSchema,
} from "../ai/schemas";

const card = {
  what: "Added a scoring step",
  why: null,
  why_inferred: true,
  how: null,
  impact: null,
  significance: 2,
  open_question: "Why did you add scoring?",
};

describe("ai schemas", () => {
  it("accepts a valid change card and rejects bad significance or long what", () => {
    expect(ChangeCardSchema.safeParse(card).success).toBe(true);
    expect(ChangeCardSchema.safeParse({ ...card, significance: 4 }).success).toBe(false);
    expect(ChangeCardSchema.safeParse({ ...card, significance: 1.5 }).success).toBe(false);
    expect(ChangeCardSchema.safeParse({ ...card, what: "x".repeat(281) }).success).toBe(false);
  });

  it("parses a brief", () => {
    const brief = {
      pitch: "p",
      audience: "a",
      problem: "pr",
      architecture: [{ module: "src/lib", purpose: "logic" }],
      glossary: [{ term: "gate", plain: "rule check" }],
      stack: ["Next.js"],
      milestones: ["v1"],
      facts: ["MIT licensed"],
    };
    expect(BriefSchema.safeParse(brief).success).toBe(true);
  });

  it("parses file summaries", () => {
    expect(FileSummarySchema.safeParse({ summaries: [{ path: "a.ts", summary: "does a" }] }).success).toBe(true);
  });

  it("parses compose output with channel keyed variants", () => {
    expect(ComposeSchema.safeParse({ variants: { linkedin: "x", x: "y" }, themes: ["speed"] }).success).toBe(true);
  });

  it("bounds voice check scores and suggestions", () => {
    expect(VoiceCheckSchema.safeParse({ scores: { x: 0.2 }, suggestions: { x: ["a"] } }).success).toBe(true);
    expect(VoiceCheckSchema.safeParse({ scores: { x: 1.2 }, suggestions: {} }).success).toBe(false);
    expect(VoiceCheckSchema.safeParse({ scores: {}, suggestions: { x: ["a", "b", "c", "d"] } }).success).toBe(false);
  });

  it("parses voice DNA with at most 3 examples", () => {
    const dna = {
      tone: "plain",
      openers: ["Shipped"],
      closers: [],
      sentence: { avg_len: 12, fragments: true },
      vocab: { signature: ["ship"], never: ["delve"] },
      format: { emoji: "none", line_breaks: "short paragraphs", hashtags: "1 max" },
      examples: ["a", "b", "c"],
    };
    expect(VoiceDnaSchema.safeParse(dna).success).toBe(true);
    expect(VoiceDnaSchema.safeParse({ ...dna, examples: ["a", "b", "c", "d"] }).success).toBe(false);
  });

  it("caps rule proposals at 2", () => {
    const p = { kind: "never", rule: "no 'super excited'", pattern: null };
    expect(RuleProposalsSchema.safeParse({ proposals: [p, p] }).success).toBe(true);
    expect(RuleProposalsSchema.safeParse({ proposals: [p, p, p] }).success).toBe(false);
    expect(RuleProposalsSchema.safeParse({ proposals: [{ ...p, kind: "maybe" }] }).success).toBe(false);
  });
});
