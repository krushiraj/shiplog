// View models for the UI. Kept close to src/db/schema.ts so the backend can map rows 1:1.

export type ChannelKey = "linkedin" | "x" | "threads";

export const CHANNELS: Record<ChannelKey, { label: string; limit: number }> = {
  linkedin: { label: "LinkedIn", limit: 3000 },
  x: { label: "X", limit: 280 },
  threads: { label: "Threads", limit: 500 },
};

export type Significance = 0 | 1 | 2 | 3;

export const SIGNIFICANCE_LABEL: Record<Significance, string> = {
  0: "Chore",
  1: "Fix",
  2: "Feature",
  3: "Milestone",
};

export type ChangeCardView = {
  id: string;
  repo: string;
  ref: string; // short sha, "#42", or tag
  kind: "commit" | "pr_merged" | "release" | "tag" | "issue_closed";
  url: string;
  what: string;
  why: string | null;
  whyInferred: boolean;
  how: string | null;
  impact: string | null;
  significance: Significance;
  occurredAt: string; // ISO
};

export type VoiceSuggestion = { id: string; text: string };

export type DraftView = {
  id: string;
  project: { id: string; name: string };
  trigger: { kind: "digest" | "release" | "instant"; label: string };
  slot: { label: string; iso: string };
  variants: Partial<Record<ChannelKey, string>>;
  cards: ChangeCardView[];
  openQuestion: { cardId: string; question: string } | null;
  gate: { drift: number; suggestions: VoiceSuggestion[]; fixed: string[] };
  createdAt: string;
};

export type PostRow = {
  id: string;
  project: string;
  channel: ChannelKey;
  excerpt: string;
  status: "sent" | "queued" | "error";
  at: string; // ISO
  bufferUrl: string | null;
  sources: { ref: string; url: string }[];
};

export type ProjectView = {
  id: string;
  name: string;
  repos: string[];
  channels: ChannelKey[];
  cadence: string;
  reviewMode: "inbox" | "draft" | "auto";
  paused: boolean;
  stats: { changesThisWeek: number; postsThisWeek: number; streakDays: number };
};

export type VoiceRuleView = {
  id: string;
  kind: "never" | "prefer" | "format";
  rule: string;
  register: string | null;
  source: string;
  sightings: number;
  active: boolean;
};

export type BriefView = {
  pitch: string;
  audience: string;
  problem: string;
  stack: string[];
  glossary: { term: string; plain: string }[];
  architecture: { module: string; purpose: string }[];
  milestones: string[];
  /** Author answers to open questions, appended over time. */
  facts?: string[];
};

/** Quick reject reasons in the inbox. They describe the draft, not the voice, so they never become voice rules. */
export const REJECT_REASONS = ["Not worth a post", "Facts are wrong", "Doesn't sound like me"] as const;
