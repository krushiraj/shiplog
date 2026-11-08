import { scrub } from "../scrub";
import type { Brief, VoiceDna } from "./schemas";

export type Prompt = { system: string; user: string };

export type EventContext = {
  kind: string;
  title?: string | null;
  body?: string | null;
  message?: string | null;
  labels?: string[];
  issues?: { title: string; body?: string | null }[];
};
export type FileContext = { path: string; status?: string; patch?: string | null; summary?: string | null };
export type CardInput = {
  what: string;
  why?: string | null;
  how?: string | null;
  impact?: string | null;
  significance: number;
};
export type RuleInput = { kind: string; rule: string; pattern?: string | null };
export type ChannelSpec = { key: string; register: string; limit: number };

// Inputs are expected pre-scrubbed; this is a second net so a stray secret never reaches the model.
const safe = (p: Prompt): Prompt => ({ system: scrub(p.system), user: scrub(p.user) });
const json = (v: unknown) => JSON.stringify(v, null, 2);
const section = (title: string, body: string) => `<${title}>\n${body}\n</${title}>`;

const AI_ISMS = [
  "em dashes (—); use commas, full stops or parentheses",
  '"excited to announce", "thrilled to share", "super excited"',
  '"delve", "leverage", "game-changer", "seamless", "unlock", "elevate", "robust"',
  "the \"this isn't X, it's Y\" construction",
  "rhetorical questions as openers and lists of exactly three adjectives",
];

function briefBlock(brief: Brief | null | undefined): string {
  if (!brief) return section("project_brief", "No brief yet. Rely on the event itself.");
  return section("project_brief", json(brief));
}

export function analysePrompt({
  brief,
  event,
  files,
  readDiffs,
}: {
  brief: Brief | null | undefined;
  event: EventContext;
  files: FileContext[];
  readDiffs: boolean;
}): Prompt {
  const system = `You turn one software change into a "change card" that a non-expert can read.

Return JSON: {"what": string ≤280, "why": string|null, "why_inferred": boolean, "how": string|null, "impact": string|null, "significance": 0|1|2|3, "open_question": string|null}.

Rules:
- what: one or two plain sentences on what changed, from the user's point of view where possible.
- why: take it ONLY from evidence: the PR body, linked issues, the commit message, or goals stated in the project brief. If you have to guess, write your best guess and set why_inferred=true. If there is no evidence and no sensible guess, set why=null and why_inferred=true. With direct evidence, why_inferred=false.
- how: the approach in one or two sentences, from the diff. null if there is no diff to read.
- impact: who benefits and how, for users and developers. Use numbers only when the evidence gives them. null if unclear.
- significance rubric:
  0 = chore, dependency bump, formatting, CI, docs typo
  1 = bug fix or refactor
  2 = user-visible feature or improvement
  3 = milestone, release, or a new capability
- open_question: ask ONE short question (≤160 chars) to the author only when why is unknown (why=null or why_inferred=true) AND significance is 2 or higher. Otherwise null.
- Use plain words. When the project glossary has a term, say it in its plain form.
- Never include code, identifiers in backticks, file contents, or secrets (keys, tokens, passwords, URLs with credentials) in any field.

${briefBlock(brief)}`;

  const fileLines = files.map((f) => {
    const head = `${f.path}${f.status ? ` (${f.status})` : ""}`;
    if (!readDiffs) return head;
    const body = f.patch ?? f.summary;
    return body ? `${head}\n${body}` : head;
  });

  const user = [
    section(
      "event",
      json({
        kind: event.kind,
        title: event.title ?? null,
        message: event.message ?? null,
        body: event.body ?? null,
        labels: event.labels ?? [],
        linked_issues: event.issues ?? [],
      }),
    ),
    section(
      readDiffs ? "changed_files" : "changed_files_metadata_only",
      fileLines.join("\n\n") || "(no files)",
    ),
    readDiffs ? "" : "Diffs are not available for this repo: describe the change from metadata only and set how=null.",
    "Write the change card.",
  ]
    .filter(Boolean)
    .join("\n\n");

  return safe({ system, user });
}

export function briefFileSummariesPrompt(files: { path: string; content: string }[]): Prompt {
  const system = `You summarise source files for a project overview.
For each file write one line (≤200 chars) on what it is for, in plain words. Describe purpose, not implementation. Never quote code or secrets.
Return JSON: {"summaries": [{"path": string, "summary": string}]} with one entry per file, same paths as given.`;
  const user = files.map((f) => section("file", `path: ${f.path}\n${f.content}`)).join("\n\n");
  return safe({ system, user });
}

export function briefPrompt({
  repos,
  readme,
  docs,
  manifests,
  tree,
  fileSummaries,
}: {
  repos: string[];
  readme: string | null;
  docs: { path: string; content: string }[];
  manifests: { path: string; content: string }[];
  tree: string[];
  fileSummaries: { path: string; summary: string }[];
}): Prompt {
  const system = `You write a project brief that later prompts use to explain changes to a general audience.
Return JSON: {"pitch": string, "audience": string, "problem": string, "architecture": [{"module": string, "purpose": string}], "glossary": [{"term": string, "plain": string}], "stack": string[], "milestones": string[], "facts": string[]}.
- pitch: one sentence a stranger would understand.
- audience and problem: who it is for and what pain it removes.
- architecture: the main modules (paths or names) and what each does, in plain words. At most 15.
- glossary: internal names, jargon and acronyms mapped to plain words. Only terms that actually appear in the material.
- stack: languages, frameworks and services in use.
- milestones: shipped or planned milestones stated in the material.
- facts: short, checkable facts (licence, platforms, numbers) stated in the material.
Only use what the material says. Do not invent features. Never quote code or secrets.`;
  const user = [
    section("repos", repos.join("\n")),
    section("readme", readme ?? "(none)"),
    ...docs.map((d) => section("doc", `path: ${d.path}\n${d.content}`)),
    ...manifests.map((m) => section("manifest", `path: ${m.path}\n${m.content}`)),
    section("file_tree", tree.join("\n")),
    section("file_summaries", fileSummaries.map((f) => `${f.path}: ${f.summary}`).join("\n")),
  ].join("\n\n");
  return safe({ system, user });
}

export type ComposeVoice = {
  dna: Record<string, Partial<VoiceDna> | Record<string, unknown>>;
  activeRules: RuleInput[];
  examples: Record<string, string[]>;
};

export function composePrompt({
  brief,
  cards,
  voice,
  channels,
  recentPosts,
  trigger,
  nudge,
  hashtags,
  link,
}: {
  brief: Brief | null | undefined;
  cards: CardInput[];
  voice: ComposeVoice;
  channels: ChannelSpec[];
  recentPosts: string[];
  trigger: string;
  nudge?: string | null;
  hashtags: string[];
  link?: string | null;
}): Prompt {
  const system = `You write build-in-public posts for a developer, in their own voice, about what they shipped.

Write a short story, not a changelog: group the changes into one to three themes (the problem, what changed, why it matters to the reader) and lead with the most significant one. Skip chores (significance 0) unless nothing else happened. Do not list every change.

For every channel, write one variant that fits the channel's register and stays within its character limit (count every character, including hashtags and the link).

Voice:
- Follow the voice DNA for each register: tone, openers, closers, sentence length, signature words, formatting (emoji, line breaks, hashtags).
- Follow every active rule. "never" rules are hard bans.
- Match the rhythm of the example posts, but do not copy their sentences.

Avoid these AI-isms:
${AI_ISMS.map((a) => `- ${a}`).join("\n")}

Never quote code, file paths, function names, or secrets. Describe what changed in plain words. Never claim numbers that the cards do not state.
Do not repeat angles or phrasing from the recent posts.

Return JSON: {"variants": {"<channel key>": string}, "themes": string[]} with exactly one entry per channel key.

${briefBlock(brief)}

${section("voice_dna", json(voice.dna))}

${section("active_rules", voice.activeRules.map((r) => `- [${r.kind}] ${r.rule}${r.pattern ? ` (pattern: ${r.pattern})` : ""}`).join("\n") || "(none)")}

${section("example_posts", json(voice.examples))}`;

  const extras = [
    hashtags.length ? `Hashtags to include where the register allows: ${hashtags.map((h) => `#${h.replace(/^#/, "")}`).join(" ")}` : "No hashtags.",
    link ? `Include this link once: ${link}` : "No link.",
    nudge ? `Author's note for this post: ${nudge}` : "",
  ].filter(Boolean);

  const user = [
    section("trigger", trigger),
    section("change_cards", json(cards)),
    section("channels", channels.map((c) => `- ${c.key}: register=${c.register}, limit=${c.limit} chars`).join("\n")),
    section("recent_posts", recentPosts.map((p, i) => `${i + 1}. ${p}`).join("\n") || "(none)"),
    section("extras", extras.join("\n")),
    "Write the variants.",
  ].join("\n\n");

  return safe({ system, user });
}

export function voiceCheckPrompt({
  drafts,
  voice,
}: {
  drafts: Record<string, string>;
  voice: Record<string, Partial<VoiceDna> | Record<string, unknown>>;
}): Prompt {
  const system = `You check whether drafts sound like their author.
For each draft, score drift from the author's voice DNA from 0 (sounds exactly like them) to 1 (sounds nothing like them), and give up to 3 short, concrete edit suggestions (each under 80 chars). Empty list when the draft already fits.
Return JSON: {"scores": {"<key>": number}, "suggestions": {"<key>": string[]}} with the same keys as the drafts.`;
  const user = [section("voice_dna", json(voice)), section("drafts", json(drafts))].join("\n\n");
  return safe({ system, user });
}

export function voiceExtractPrompt({
  samples,
  register,
  interview,
}: {
  samples: string[];
  register: string;
  interview?: { q: string; a: string }[];
}): Prompt {
  const system = `You build a "voice DNA" profile from a writer's own posts so new drafts sound like them.
Return JSON:
{"tone": string, "openers": string[], "closers": string[], "sentence": {"avg_len": number, "fragments": boolean}, "vocab": {"signature": string[], "never": string[]}, "format": {"emoji": string, "line_breaks": string, "hashtags": string}, "examples": string[]}
- tone: a short description of how they sound.
- openers / closers: patterns they really use to start and end posts (up to 5 each).
- sentence.avg_len: average words per sentence; fragments: whether they use sentence fragments.
- vocab.signature: words and phrases typical of them. vocab.never: words they avoid, plus generic AI phrasing they would never use.
- format: how they use emoji, line breaks and hashtags.
- examples: the 3 samples that best show this voice, copied verbatim (fewer if fewer were given).
Describe only what the samples and answers show.`;
  const user = [
    section("register", register),
    section("samples", samples.map((s, i) => `--- sample ${i + 1}\n${s}`).join("\n")),
    interview?.length ? section("interview", interview.map((x) => `Q: ${x.q}\nA: ${x.a}`).join("\n\n")) : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return safe({ system, user });
}

export function ruleProposalPrompt({
  before,
  after,
  signals,
}: {
  before: string;
  after: string;
  signals: Record<string, unknown>;
}): Prompt {
  const system = `A writer edited a draft before posting it. Infer what their edit says about their voice.
Propose at most 2 concise, reusable rules. Each rule is {"kind": "never"|"prefer"|"format", "rule": string, "pattern": string|null}.
- never: a word or phrase to ban. pattern is a case-insensitive regex for it, or null.
- prefer: a word or style to use instead.
- format: emoji, hashtags, line breaks or length.
Only propose rules that would generalise to future posts. Ignore one-off factual corrections. Return {"proposals": []} when nothing generalises.
Return JSON: {"proposals": [...]}.`;
  const user = [section("before", before), section("after", after), section("diff_signals", json(signals))].join("\n\n");
  return safe({ system, user });
}
