import { describe, expect, it } from "vitest";
import {
  analysePrompt,
  briefFileSummariesPrompt,
  briefPrompt,
  composePrompt,
  ruleProposalPrompt,
  voiceCheckPrompt,
  voiceExtractPrompt,
} from "../ai/prompts";

const SECRET = "ghp_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const brief = {
  pitch: "Shiplog turns commits into posts",
  audience: "indie devs",
  problem: "posting is a chore",
  architecture: [{ module: "src/lib/gate", purpose: "rule checks" }],
  glossary: [{ term: "gate", plain: "a rule check before posting" }],
  stack: ["Next.js"],
  milestones: ["first post"],
  facts: [],
};
const event = {
  kind: "pull_request",
  title: "Add scoring",
  body: `Closes #4. Users asked for ranking. token=${SECRET}`,
  message: null,
  labels: ["feature"],
};
const files = [{ path: "src/lib/score.ts", status: "added", patch: "+export const score = 1;" }];

const text = (p: { system: string; user: string }) => p.system + "\n" + p.user;

describe("analysePrompt", () => {
  const p = analysePrompt({ brief, event, files, readDiffs: true });

  it("states the evidence and open-question rules and the rubric", () => {
    expect(p.system).toMatch(/why_inferred/);
    expect(p.system).toMatch(/evidence/i);
    expect(p.system).toMatch(/open_question/);
    expect(p.system).toMatch(/significance\s*(is\s*)?(>=|≥|of)\s*2|2 or (higher|more)/i);
    for (const s of ["0", "1", "2", "3"]) expect(p.system).toContain(`${s} =`);
    expect(p.system).toMatch(/never (include|quote) code/i);
    expect(p.system).toMatch(/secret/i);
    expect(p.system).toMatch(/glossary/i);
  });

  it("includes brief, event and file context", () => {
    expect(p.user).toContain("Add scoring");
    expect(p.user).toContain("Users asked for ranking");
    expect(p.user).toContain("src/lib/score.ts");
    expect(p.user).toContain("+export const score");
    expect(text(p)).toContain("a rule check before posting");
  });

  it("scrubs secrets that slip through", () => {
    expect(text(p)).not.toContain(SECRET);
  });

  it("omits patches when readDiffs is false", () => {
    const meta = analysePrompt({ brief, event, files, readDiffs: false });
    expect(meta.user).toContain("src/lib/score.ts");
    expect(meta.user).not.toContain("+export const score");
  });

  it("works without a brief", () => {
    expect(analysePrompt({ brief: null, event, files, readDiffs: true }).user).toContain("Add scoring");
  });
});

describe("brief prompts", () => {
  it("summarises files in one line each", () => {
    const p = briefFileSummariesPrompt([{ path: "src/a.ts", content: `const k = "${SECRET}"` }]);
    expect(p.user).toContain("src/a.ts");
    expect(text(p)).not.toContain(SECRET);
    expect(p.system).toMatch(/one line/i);
  });

  it("builds the brief from repo material", () => {
    const p = briefPrompt({
      repos: ["me/shiplog"],
      readme: "# Shiplog\nBuild in public",
      docs: [{ path: "docs/design.md", content: "design" }],
      manifests: [{ path: "package.json", content: '{"name":"shiplog"}' }],
      tree: ["src/lib/gate.ts"],
      fileSummaries: [{ path: "src/lib/gate.ts", summary: "checks drafts" }],
    });
    expect(p.user).toContain("me/shiplog");
    expect(p.user).toContain("Build in public");
    expect(p.user).toContain("checks drafts");
    expect(p.system).toMatch(/glossary/i);
    expect(p.system).toMatch(/plain/i);
  });
});

describe("composePrompt", () => {
  const p = composePrompt({
    brief,
    cards: [
      { what: "Added scoring", why: "users asked", how: null, impact: "faster triage", significance: 2 },
      { what: "Fixed retry loop", why: null, how: null, impact: null, significance: 1 },
    ],
    voice: {
      dna: { linkedin: { tone: "plain and warm" }, "x-short": { tone: "punchy" } },
      activeRules: [{ kind: "never", rule: "no 'super excited'" }],
      examples: { linkedin: ["Shipped a thing today."] },
    },
    channels: [
      { key: "li-main", register: "linkedin", limit: 3000 },
      { key: "x-main", register: "x-short", limit: 280 },
    ],
    recentPosts: ["Yesterday I shipped the inbox."],
    trigger: "digest",
    nudge: "mention the beta",
    hashtags: ["buildinpublic"],
    link: "https://shiplog.dev",
  });

  it("asks for a themed story, not a changelog", () => {
    expect(p.system).toMatch(/theme/i);
    expect(p.system).toMatch(/not a changelog/i);
  });

  it("bans AI-isms and code", () => {
    expect(p.system).toMatch(/em dash/i);
    expect(p.system).toMatch(/excited to announce/i);
    expect(p.system).toMatch(/delve/i);
    expect(p.system).toMatch(/isn't X, it's Y/);
    expect(p.system).toMatch(/never quote code/i);
  });

  it("includes channels with limits, voice, rules, recent posts, hashtags, link and nudge", () => {
    const all = text(p);
    expect(all).toContain("li-main");
    expect(all).toContain("3000");
    expect(all).toContain("x-main");
    expect(all).toContain("280");
    expect(all).toContain("plain and warm");
    expect(all).toContain("no 'super excited'");
    expect(all).toContain("Yesterday I shipped the inbox.");
    expect(all).toContain("#buildinpublic");
    expect(all).toContain("https://shiplog.dev");
    expect(all).toContain("mention the beta");
    expect(all).toContain("Added scoring");
  });
});

describe("voice prompts", () => {
  it("voice check asks for 0..1 scores and up to 3 suggestions", () => {
    const p = voiceCheckPrompt({
      drafts: { "x-main": "Shipped scoring." },
      voice: { "x-main": { tone: "punchy" } },
    });
    expect(p.user).toContain("Shipped scoring.");
    expect(p.system).toMatch(/0\b.*1\b/);
    expect(p.system).toMatch(/3/);
  });

  it("voice extract covers the DNA fields and the register", () => {
    const p = voiceExtractPrompt({
      samples: ["Shipped it.", "Small win today."],
      register: "x-short",
      interview: [{ q: "Who do you write for?", a: "other devs" }],
    });
    for (const f of ["tone", "openers", "closers", "avg_len", "signature", "never", "emoji", "examples"])
      expect(p.system).toContain(f);
    expect(p.user).toContain("x-short");
    expect(p.user).toContain("Small win today.");
    expect(p.user).toContain("other devs");
  });

  it("rule proposal includes before, after and signals, max 2", () => {
    const p = ruleProposalPrompt({
      before: "Super excited to share scoring!",
      after: "Shipped scoring.",
      signals: { removed: ["Super excited to share"], added: ["Shipped"], emojiDelta: 0, hashtagDelta: 0 },
    });
    expect(p.user).toContain("Super excited to share scoring!");
    expect(p.user).toContain("Shipped scoring.");
    expect(p.system).toMatch(/at most 2|up to 2|≤ ?2/i);
    expect(p.system).toMatch(/never|prefer|format/);
  });
});

describe("composePrompt project log", () => {
  const base = {
    brief: null,
    cards: [{ what: "Added scoring", why: null, how: null, impact: null, significance: 2 }],
    voice: { dna: {}, activeRules: [], examples: {} },
    channels: [{ key: "x-main", register: "x-short" as const, limit: 280 }],
    recentPosts: [],
    trigger: "digest",
    hashtags: [],
  };

  it("puts the log in the per-call part so the cached system prompt stays stable", () => {
    const p = composePrompt({ ...base, projectLog: ["2026-11-08: Shipped the inbox"] });
    expect(p.user).toContain("2026-11-08: Shipped the inbox");
    expect(p.system).not.toContain("Shipped the inbox");
  });

  it("leaves the section out when there is no log", () => {
    expect(composePrompt(base).user).not.toContain("project_log");
  });
});
