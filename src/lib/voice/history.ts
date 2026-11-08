import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users, type CachedChannel } from "@/db/schema";
import { bufferGql } from "@/lib/buffer/client";
import { SENT_POSTS_QUERY, type SentPost, type SentPostsResult } from "@/lib/buffer/queries";
import { extractVoice, REGISTERS, type Register, type VoiceInput, type VoiceProfiles } from "./extract";

/** Buffer calls one auto-learn may spend (each returns up to 50 sent posts). */
export const MAX_HISTORY_CALLS = 6;
/** Stop paging a register once it has this many usable samples. */
const TARGET_SAMPLES = 20;
export const MIN_SAMPLES = 5;
const MIN_CHARS = 40;

const REGISTER_OF: Record<string, Register> = {
  linkedin: "linkedin",
  twitter: "x-short",
  threads: "x-short",
  bluesky: "x-short",
  mastodon: "x-short",
  instagram: "x-short",
};

export type WritingSample = {
  text: string;
  service: string;
  channelId: string;
  sentAt: string | null;
  kind: "post" | "first_comment";
};

export type ChannelCount = { channelId: string; name: string; service: string; posts: number };

export type WritingHistory = Record<Register, WritingSample[]> & {
  perChannel: ChannelCount[];
  channelsPerRegister: Record<Register, number>;
  calls: number;
};

export type HistoryDeps = {
  gql: <T>(query: string, variables: Record<string, unknown>) => Promise<T>;
  loadUser: (userId: string) => Promise<{ org: string | null; channels: CachedChannel[] }>;
};

const defaultHistoryDeps = (userId: string): HistoryDeps => ({
  gql: (query, variables) => bufferGql(userId, query, variables),
  loadUser: async (id) => {
    const [row] = await db.select({ org: users.organizationId, channels: users.channels }).from(users).where(eq(users.id, id)).limit(1);
    return { org: row?.org ?? null, channels: row?.channels ?? [] };
  },
});

const isUsable = (text: string) => !/^RT @/i.test(text) && text.replace(/https?:\/\/\S+/g, "").trim().length >= MIN_CHARS;

function samplesOf(post: SentPost): WritingSample[] {
  if (post.metadata?.retweet) return [];
  const base = { service: post.channelService, channelId: post.channelId, sentAt: post.sentAt };
  const parts = (post.metadata?.thread ?? []).map((t) => t.text?.trim()).filter((t): t is string => Boolean(t));
  const text = parts.length > 1 ? parts.join("\n\n") : (post.text ?? "").trim();
  const comment = post.metadata?.firstComment?.trim() ?? "";
  return [
    { ...base, text, kind: "post" as const },
    { ...base, text: comment, kind: "first_comment" as const },
  ].filter((s) => isUsable(s.text));
}

/**
 * The user's own sent posts across connected channels, grouped by register.
 * Pages round-robin across registers so one busy network cannot starve the other.
 */
export async function fetchWritingHistory(userId: string, deps: HistoryDeps = defaultHistoryDeps(userId)): Promise<WritingHistory> {
  const { org, channels } = await deps.loadUser(userId);
  const byRegister = Object.fromEntries(REGISTERS.map((r) => [r, channels.filter((c) => REGISTER_OF[c.service] === r)])) as Record<Register, CachedChannel[]>;
  const samples = Object.fromEntries(REGISTERS.map((r) => [r, [] as WritingSample[]])) as Record<Register, WritingSample[]>;
  const seen = new Set<string>();
  const cursor: Partial<Record<Register, string | null>> = {};
  const done = new Set<Register>(REGISTERS.filter((r) => !org || byRegister[r].length === 0));
  let calls = 0;

  while (calls < MAX_HISTORY_CALLS && done.size < REGISTERS.length) {
    for (const register of REGISTERS) {
      if (done.has(register) || calls >= MAX_HISTORY_CALLS) continue;
      calls++;
      const data = await deps.gql<SentPostsResult>(SENT_POSTS_QUERY, {
        org,
        channelIds: byRegister[register].map((c) => c.id),
        after: cursor[register] ?? null,
      });
      for (const edge of data.posts.edges ?? []) {
        for (const s of samplesOf(edge.node)) {
          const key = s.text.toLowerCase().replace(/\s+/g, " ");
          if (seen.has(key)) continue;
          seen.add(key);
          samples[register].push(s);
        }
      }
      cursor[register] = data.posts.pageInfo.endCursor;
      if (!data.posts.pageInfo.hasNextPage || samples[register].length >= TARGET_SAMPLES) done.add(register);
    }
  }

  const recentFirst = (a: WritingSample, b: WritingSample) => (b.sentAt ?? "").localeCompare(a.sentAt ?? "");
  for (const r of REGISTERS) samples[r].sort(recentFirst);

  const all = REGISTERS.flatMap((r) => samples[r]);
  const perChannel = channels
    .filter((c) => REGISTER_OF[c.service])
    .map((c) => ({ channelId: c.id, name: c.displayName ?? c.name, service: c.service, posts: all.filter((s) => s.channelId === c.id && s.kind === "post").length }));
  const channelsPerRegister = Object.fromEntries(REGISTERS.map((r) => [r, byRegister[r].length])) as Record<Register, number>;

  return { ...samples, perChannel, channelsPerRegister, calls };
}

export type NeedsMore = { register: Register; have: number; channels: number };

export type AutoLearnResult = {
  profiles: Partial<VoiceProfiles>;
  used: Record<Register, WritingSample[]>;
  needsMore: NeedsMore[];
  perChannel: ChannelCount[];
};

export type AutoLearnDeps = HistoryDeps & { extract: (userId: string, input: VoiceInput) => Promise<Partial<VoiceProfiles>> };

/** Reads the user's Buffer history and learns a voice for every register with enough real posts. */
export async function autoLearnVoice(userId: string, deps: AutoLearnDeps = { ...defaultHistoryDeps(userId), extract: extractVoice }): Promise<AutoLearnResult> {
  const history = await fetchWritingHistory(userId, deps);
  const used = Object.fromEntries(REGISTERS.map((r) => [r, history[r].slice(0, TARGET_SAMPLES)])) as Record<Register, WritingSample[]>;
  const learnable = REGISTERS.filter((r) => used[r].length >= MIN_SAMPLES);

  const learned = await Promise.all(learnable.map((r) => deps.extract(userId, { samples: used[r].map((s) => s.text), registers: [r] })));
  const profiles: Partial<VoiceProfiles> = Object.assign({}, ...learned);

  const nothingLearned = learnable.length === 0;
  const needsMore = REGISTERS.filter((r) => !learnable.includes(r) && (nothingLearned || history.channelsPerRegister[r] > 0)).map((r) => ({
    register: r,
    have: history[r].length,
    channels: history.channelsPerRegister[r],
  }));

  return { profiles, used, needsMore, perChannel: history.perChannel };
}
