import { containsHardSecret } from "./scrub";

export type GateRule = { kind: "never" | "prefer" | "format"; rule: string; pattern?: string | null };

export type GateOptions = {
  channel: "x" | "linkedin" | "threads" | "bluesky" | "mastodon" | (string & {});
  rules: GateRule[];
  hashtags: string[];
  maxHashtags?: number;
  maxEmoji?: number;
};

export type Violation = {
  kind: "length" | "never" | "hashtags" | "emoji" | "ai_pattern";
  detail: string;
  rule?: string;
};

export type GateResult = { text: string; fixed: string[]; violations: Violation[]; blocked: boolean };

// docs/buffer-api.md §5. X assumes the free tier; Mastodon uses the default server limit.
export const LIMITS: Record<string, number> = {
  x: 280,
  twitter: 280,
  linkedin: 3000,
  threads: 500,
  bluesky: 300,
  mastodon: 500,
  facebook: 5000,
  instagram: 2196,
  pinterest: 500,
  tiktok: 2200,
  youtube: 5000,
  googlebusiness: 4000,
  substack: 10000,
};
export const DEFAULT_LIMIT = 3000;

const URL_RE = /https?:\/\/\S+/g;
const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const PICTOGRAPHIC = /\p{Extended_Pictographic}/u;
const PROTECTED_RE = /`[^`\n]*`|https?:\/\/\S+/g;

const AI_PATTERNS: { re: RegExp; detail: string }[] = [
  {
    re: /\b(?:this|that|it)\s+(?:isn['’]t|is not|wasn['’]t|was not)\s+(?:just\s+|only\s+)?[^.!?\n]{1,80}?[,;:]\s*(?:it|this|that)(?:['’]s|\s+is|\s+was)\b/i,
    detail: `"this isn't X, it's Y" construction`,
  },
  {
    re: /\b(?:it['’]s|it is|this is|that['’]s|that is)\s+not\s+(?:just\s+|only\s+)?[^.!?\n]{1,80}?[,;:]\s*(?:it|this|that)(?:['’]s|\s+is|\s+was)\b/i,
    detail: `"it's not just X, it's Y" construction`,
  },
  { re: /\bexcited to announce\b/i, detail: `"excited to announce"` },
  { re: /\bthrilled to\b/i, detail: `"thrilled to"` },
];

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const matchCase = (source: string, replacement: string) =>
  /^\p{Lu}/u.test(source) ? upperFirst(replacement) : replacement;
const atSentenceStart = (before: string) => /(?:^|[.!?]\s*|\n\s*)$/.test(before);

function protectedRanges(text: string): [number, number][] {
  return [...text.matchAll(PROTECTED_RE)].map((m) => [m.index, m.index + m[0].length]);
}

function fixDashes(text: string): string {
  const ranges = protectedRanges(text);
  return text.replace(/[ \t]*,?[ \t]*[—–][ \t]*/g, (m, offset: number, str: string) => {
    if (ranges.some(([start, end]) => offset < end && offset + m.length > start)) return m;
    const prev = str[offset - 1] ?? "";
    const next = str[offset + m.length] ?? "";
    const rest = str.slice(offset + m.length, offset + m.length + 2);
    if (/\d/.test(prev) && /^v?\d/i.test(rest) && !m.includes(",")) {
      return /\d/.test(next) && !/\s/.test(m) ? m : "-";
    }
    if (!prev || prev === "\n") return "";
    if (!next || next === "\n") return "";
    if (/[.!?,;:]/.test(prev)) return " ";
    return /\p{Lu}/u.test(next) ? ". " : ", ";
  });
}

/** `re` captures (1) leading whitespace and (2) the first letter after the phrase, if any. */
function removePhrase(text: string, re: RegExp): string {
  return text.replace(re, (...args) => {
    const [, lead, next] = args as [string, string, string | undefined];
    const offset = args[args.length - 2] as number;
    const str = args[args.length - 1] as string;
    if (!next) return "";
    return lead + (atSentenceStart(str.slice(0, offset)) ? next.toUpperCase() : next);
  });
}

const DELVE: Record<string, string> = { delve: "dig", delves: "digs", delved: "dug", delving: "digging" };

type Fix = { label: string; apply: (text: string) => string };

const FIXES: Fix[] = [
  { label: "replaced em/en dashes", apply: fixDashes },
  {
    label: `replaced "delve" with "dig"`,
    apply: (t) =>
      t.replace(/\bdelv(?:e|es|ed|ing)\b/gi, (word) => matchCase(word, DELVE[word.toLowerCase()])),
  },
  {
    label: `replaced "game-changer" with "big change"`,
    apply: (t) => t.replace(/\bgame[- ]changer(s?)\b/gi, (m, s: string) => matchCase(m, `big change${s}`)),
  },
  {
    label: `removed "in today's fast-paced world"`,
    apply: (t) => removePhrase(t, /([ \t]*)in today['’]s fast[- ]paced world,?[ \t]*(\p{L})?/giu),
  },
  {
    label: `removed "let's dive in"`,
    apply: (t) => removePhrase(t, /([ \t]*)let['’]s dive in\b[.!:…]*[ \t]*(\p{L})?/giu),
  },
  {
    label: "collapsed extra blank lines",
    apply: (t) => t.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"),
  },
];

export function countChars(text: string, channel: string): number {
  switch (channel) {
    case "x":
    case "twitter":
    case "mastodon":
      return text.replace(URL_RE, "x".repeat(23)).length;
    case "linkedin":
      return text.replace(URL_RE, "x".repeat(24)).length;
    case "bluesky":
      return [...new Intl.Segmenter().segment(text)].length;
    default:
      return text.length;
  }
}

/** Config hashtags the poster will append because the text doesn't already carry them. */
function appendedHashtags(text: string, extra: string[]): string[] {
  const inText = (text.match(HASHTAG_RE) ?? []).map((h) => h.trim().toLowerCase());
  return extra.map((h) => (h.startsWith("#") ? h : `#${h}`)).filter((h) => !inText.includes(h.toLowerCase()));
}

function emojiCount(text: string): number {
  return [...new Intl.Segmenter().segment(text)].filter((s) => PICTOGRAPHIC.test(s.segment.replace(/[©®™]/g, "")))
    .length;
}

// Cheap ReDoS guard for user-supplied patterns: no huge patterns, no quantified groups that contain quantifiers.
const isSafePattern = (pattern: string) => pattern.length <= 200 && !/\([^)]*[+*}][^)]*\)\s*[+*{]/.test(pattern);

function neverMatches(text: string, rule: GateRule): boolean {
  if (rule.pattern) {
    if (!isSafePattern(rule.pattern)) return false;
    try {
      return new RegExp(rule.pattern, "i").test(text);
    } catch {
      return false;
    }
  }
  return text.toLowerCase().includes(rule.rule.toLowerCase());
}

export function gate(input: string, opts: GateOptions): GateResult {
  const { channel, rules, hashtags, maxHashtags = 3, maxEmoji = 2 } = opts;
  const fixed: string[] = [];
  let text = input;
  for (const fix of FIXES) {
    const next = fix.apply(text);
    if (next !== text) fixed.push(fix.label);
    text = next;
  }
  text = text.replace(/ {2,}/g, " ").trim();

  const violations: Violation[] = [];
  for (const { re, detail } of AI_PATTERNS) {
    if (re.test(text)) violations.push({ kind: "ai_pattern", detail });
  }
  for (const rule of rules) {
    if (rule.kind === "never" && neverMatches(text, rule)) {
      violations.push({ kind: "never", detail: `matches never rule "${rule.rule}"`, rule: rule.rule });
    }
  }
  const limit = LIMITS[channel] ?? DEFAULT_LIMIT;
  const extraTags = appendedHashtags(text, hashtags);
  const length = countChars([text, ...extraTags].join(" "), channel);
  if (length > limit) violations.push({ kind: "length", detail: `${length}/${limit} characters for ${channel}` });
  const tags = (text.match(HASHTAG_RE) ?? []).length + extraTags.length;
  if (tags > maxHashtags) violations.push({ kind: "hashtags", detail: `${tags} hashtags (max ${maxHashtags})` });
  const emoji = emojiCount(text);
  if (emoji > maxEmoji) violations.push({ kind: "emoji", detail: `${emoji} emoji (max ${maxEmoji})` });

  return { text, fixed, violations, blocked: containsHardSecret(input) || containsHardSecret(text) };
}
