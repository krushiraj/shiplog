import { describe, it, expect, vi } from "vitest";
import type { CachedChannel } from "@/db/schema";
import type { VoiceDna } from "@/lib/ai/schemas";
import type { SentPost as Node, SentPostsResult } from "@/lib/buffer/queries";
import { autoLearnVoice, fetchWritingHistory, MAX_HISTORY_CALLS, type HistoryDeps } from "@/lib/voice/history";

const channel = (id: string, service: string): CachedChannel => ({
  id,
  name: id,
  displayName: null,
  service,
  avatar: "",
  isDisconnected: false,
  isLocked: false,
  isQueuePaused: false,
  timezone: null,
  type: null,
  descriptor: null,
});

let seq = 0;
const long = (s: string) => `${s} — a sentence long enough to count as real writing for voice learning.`;
const node = (channelId: string, service: string, text: string, extra: Partial<Node> = {}): Node => ({
  id: `p${++seq}`,
  text,
  sentAt: new Date(Date.UTC(2026, 10, 1) - seq * 3600_000).toISOString(),
  channelId,
  channelService: service,
  metadata: null,
  ...extra,
});

/** Fake gql: serves pages per channel-id set; each call returns `pageSize` posts from the matching pool. */
function fakeGql(pools: Record<string, Node[]>, pageSize = 50) {
  const calls: Record<string, unknown>[] = [];
  const gql = vi.fn(async (_q: string, vars: Record<string, unknown>) => {
    calls.push(vars);
    const ids = vars.channelIds as string[];
    const pool = Object.entries(pools)
      .filter(([id]) => ids.includes(id))
      .flatMap(([, nodes]) => nodes);
    const start = vars.after ? Number(vars.after) : 0;
    const page = pool.slice(start, start + pageSize);
    const end = start + page.length;
    return {
      posts: { edges: page.map((n, i) => ({ cursor: String(start + i), node: n })), pageInfo: { hasNextPage: end < pool.length, endCursor: String(end) } },
    } as SentPostsResult;
  });
  return { gql: gql as unknown as HistoryDeps["gql"], calls };
}

const deps = (channels: CachedChannel[], gql: HistoryDeps["gql"], org: string | null = "org1"): HistoryDeps => ({
  gql,
  loadUser: async () => ({ org, channels }),
});

describe("fetchWritingHistory", () => {
  it("groups LinkedIn into linkedin and short-form networks into x-short", async () => {
    const { gql, calls } = fakeGql({
      li: [node("li", "linkedin", long("LinkedIn post"))],
      tw: [node("tw", "twitter", long("Tweet"))],
      ig: [node("ig", "instagram", long("Caption"))],
      th: [node("th", "threads", long("Threads post"))],
    });
    const h = await fetchWritingHistory("u1", deps([channel("li", "linkedin"), channel("tw", "twitter"), channel("ig", "instagram"), channel("th", "threads")], gql));
    expect(h.linkedin.map((s) => s.text)).toEqual([long("LinkedIn post")]);
    expect(h["x-short"].map((s) => s.service).sort()).toEqual(["instagram", "threads", "twitter"]);
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ org: "org1", channelIds: ["li"] });
    expect((calls[1].channelIds as string[]).sort()).toEqual(["ig", "th", "tw"]);
    expect(h.perChannel).toContainEqual({ channelId: "tw", name: "tw", service: "twitter", posts: 1 });
  });

  it("drops reposts, URL-only, very short and duplicate texts", async () => {
    const { gql } = fakeGql({
      tw: [
        node("tw", "twitter", long("Keeper")),
        node("tw", "twitter", "https://example.com/a-very-long-link-that-is-over-forty-characters"),
        node("tw", "twitter", "Shipped it 🚀"),
        node("tw", "twitter", `RT @someone: ${long("Retweet")}`),
        node("tw", "twitter", long("Quote"), { metadata: { retweet: { id: "x" } } }),
        node("tw", "twitter", `  ${long("Keeper")}  `),
      ],
    });
    const h = await fetchWritingHistory("u1", deps([channel("tw", "twitter")], gql));
    expect(h["x-short"].map((s) => s.text)).toEqual([long("Keeper")]);
  });

  it("joins thread parts and keeps the user's own first comment as a sample", async () => {
    const { gql } = fakeGql({
      tw: [node("tw", "twitter", long("Part one"), { metadata: { thread: [{ text: long("Part one") }, { text: long("Part two") }] } })],
      li: [node("li", "linkedin", long("Main post"), { metadata: { firstComment: long("My first comment with more context") } })],
    });
    const h = await fetchWritingHistory("u1", deps([channel("tw", "twitter"), channel("li", "linkedin")], gql));
    expect(h["x-short"][0].text).toBe(`${long("Part one")}\n\n${long("Part two")}`);
    expect(h.linkedin.map((s) => s.kind)).toEqual(["post", "first_comment"]);
  });

  it("ignores services outside both registers and skips the API when nothing is connected", async () => {
    const { gql, calls } = fakeGql({});
    const h = await fetchWritingHistory("u1", deps([channel("pin", "pinterest")], gql));
    expect(calls).toHaveLength(0);
    expect(h).toMatchObject({ linkedin: [], "x-short": [], calls: 0 });
    const noOrg = await fetchWritingHistory("u1", deps([channel("li", "linkedin")], gql, null));
    expect(noOrg.calls).toBe(0);
  });

  it("pages until it has enough samples and never exceeds the call budget", async () => {
    const many = (id: string, service: string, n: number) => Array.from({ length: n }, (_, i) => node(id, service, long(`${id} post ${i}`)));
    const short = (id: string, service: string, n: number) => Array.from({ length: n }, () => node(id, service, "too short"));
    const { gql, calls } = fakeGql({ li: [...short("li", "linkedin", 300), ...many("li", "linkedin", 3)], tw: many("tw", "twitter", 500) }, 50);
    const h = await fetchWritingHistory("u1", deps([channel("li", "linkedin"), channel("tw", "twitter")], gql));
    expect(calls.length).toBeLessThanOrEqual(MAX_HISTORY_CALLS);
    expect(h.calls).toBe(calls.length);
    // x-short hits its target in one page; linkedin gets the rest of the budget.
    expect(calls.filter((c) => (c.channelIds as string[]).includes("tw"))).toHaveLength(1);
    expect(h["x-short"].length).toBeGreaterThanOrEqual(20);
    expect(h.linkedin).toHaveLength(0);
  });
});

const dna = (tone: string): VoiceDna => ({
  tone,
  openers: [],
  closers: [],
  sentence: { avg_len: 10, fragments: false },
  vocab: { signature: [], never: [] },
  format: { emoji: "none", line_breaks: "short", hashtags: "none" },
  examples: [],
});

describe("autoLearnVoice", () => {
  it("learns registers with 5+ samples from the 20 most recent and asks for more elsewhere", async () => {
    const posts = Array.from({ length: 25 }, (_, i) => node("tw", "twitter", long(`tweet ${i}`)));
    const { gql } = fakeGql({ tw: posts, li: [node("li", "linkedin", long("only one"))] });
    const extract = vi.fn(async (_u: string, input: { samples?: string[]; registers?: string[] }) => ({ [input.registers![0]]: dna("learned") }));
    const result = await autoLearnVoice("u1", { ...deps([channel("tw", "twitter"), channel("li", "linkedin")], gql), extract: extract as never });
    expect(extract).toHaveBeenCalledTimes(1);
    const [, input] = extract.mock.calls[0];
    expect(input.registers).toEqual(["x-short"]);
    expect(input.samples).toHaveLength(20);
    expect(input.samples![0]).toBe(long("tweet 0"));
    expect(result.profiles).toEqual({ "x-short": dna("learned") });
    expect(result.needsMore).toEqual([{ register: "linkedin", have: 1, channels: 1 }]);
    expect(result.used["x-short"]).toHaveLength(20);
  });

  it("does not nag about a register with no connected channel once another register is learned", async () => {
    const posts = Array.from({ length: 6 }, (_, i) => node("tw", "twitter", long(`tweet ${i}`)));
    const { gql } = fakeGql({ tw: posts });
    const extract = vi.fn(async () => ({ "x-short": dna("learned") }));
    const result = await autoLearnVoice("u1", { ...deps([channel("tw", "twitter")], gql), extract: extract as never });
    expect(result.needsMore).toEqual([]);
  });

  it("asks for every register when nothing could be learned", async () => {
    const { gql } = fakeGql({});
    const extract = vi.fn();
    const result = await autoLearnVoice("u1", { ...deps([], gql), extract: extract as never });
    expect(extract).not.toHaveBeenCalled();
    expect(result.profiles).toEqual({});
    expect(result.needsMore).toEqual([
      { register: "linkedin", have: 0, channels: 0 },
      { register: "x-short", have: 0, channels: 0 },
    ]);
  });
});
