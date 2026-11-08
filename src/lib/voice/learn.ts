import { diffWords } from "diff";

export type DiffSignals = {
  removed: string[];
  added: string[];
  emojiDelta: number;
  hashtagDelta: number;
  lengthDelta: number;
  exclamationDelta: number;
};

export type RuleProposal = { kind: string; rule: string; pattern?: string | null };

export type Rule = RuleProposal & { sightings: number; active: boolean; lastSeenAt: Date };

const count = (text: string, re: RegExp) => text.match(re)?.length ?? 0;
const EMOJI_RE = /\p{Extended_Pictographic}/gu;
const HASHTAG_RE = /(?:^|\s)#[\p{L}\p{N}_]+/gu;
const HAS_WORD = /[\p{L}\p{N}]/u;
const DAY_MS = 24 * 60 * 60 * 1000;

export function diffSignals(before: string, after: string): DiffSignals {
  const removed: string[] = [];
  const added: string[] = [];
  let rem = "";
  let add = "";
  const flush = () => {
    if (HAS_WORD.test(rem)) removed.push(rem.trim());
    if (HAS_WORD.test(add)) added.push(add.trim());
    rem = add = "";
  };
  for (const part of diffWords(before, after)) {
    if (part.removed) rem += part.value;
    else if (part.added) add += part.value;
    else if (/^\s*$/.test(part.value)) {
      rem += part.value;
      add += part.value;
    } else flush();
  }
  flush();

  const delta = (re: RegExp) => count(after, re) - count(before, re);
  return {
    removed,
    added,
    emojiDelta: delta(EMOJI_RE),
    hashtagDelta: delta(HASHTAG_RE),
    lengthDelta: after.length - before.length,
    exclamationDelta: delta(/!/g),
  };
}

export function applySighting(existing: Rule | undefined, proposal: RuleProposal, now = new Date()): Rule {
  if (!existing) return { ...proposal, pattern: proposal.pattern ?? null, sightings: 1, active: false, lastSeenAt: now };
  const sightings = existing.sightings + 1;
  return { ...existing, sightings, lastSeenAt: now, active: existing.active || sightings >= 2 };
}

const normalize = (rule: string) => rule.trim().toLowerCase().replace(/^[\p{P}\s]+|[\p{P}\s]+$/gu, "");

export function matchRule(rules: Rule[], proposal: RuleProposal): Rule | undefined {
  const text = normalize(proposal.rule);
  return rules.find(
    (r) => r.kind === proposal.kind && ((proposal.pattern && r.pattern === proposal.pattern) || normalize(r.rule) === text),
  );
}

/** Only unconfirmed single sightings fade out; active rules stay until the user removes them. */
export function isExpired(rule: Rule, now: Date, days = 30): boolean {
  if (rule.active || rule.sightings > 1) return false;
  return now.getTime() - rule.lastSeenAt.getTime() > days * DAY_MS;
}
