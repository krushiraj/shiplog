import { describe, it, expect, vi } from "vitest";
import { publishDraft, type PublishStore, type PublishContext, type PostRow } from "@/lib/buffer/post";
import { RateLimitError } from "@/lib/buffer/client";
import { maybeAutoPublish } from "@/lib/autopost";
import { CREATE_POST_MUTATION, CREATE_TAG_MUTATION, TAGS_QUERY } from "@/lib/buffer/queries";
import type { CachedChannel } from "@/db/schema";

const channel = (id: string, service: string, over: Partial<CachedChannel> = {}): CachedChannel => ({
  id, name: id, displayName: null, service, avatar: "", isDisconnected: false, isLocked: false,
  isQueuePaused: false, timezone: null, type: null, descriptor: null, ...over,
});

function makeStore(over: { isDemo?: boolean; mode?: string; channels?: CachedChannel[] } = {}) {
  const posts = new Map<string, PostRow>();
  const draft = { status: "pending", rejectReason: null as string | null, scheduledFor: null as Date | null };
  const ctx: PublishContext = {
    draft: {
      id: "d1",
      status: "pending",
      variants: { x: "x text", linkedin: "li text" },
      finalText: { linkedin: "edited li text" },
      gate: { targets: [{ channelId: "ch_x", key: "x" }, { channelId: "ch_li", key: "linkedin" }] },
    },
    project: { id: "p1", isDemo: over.isDemo ?? false, userDefaults: {}, projectConfig: { review: { mode: over.mode ?? "inbox" } } },
    user: { id: "u1", organizationId: "org1", channels: over.channels ?? [channel("ch_x", "twitter"), channel("ch_li", "linkedin")] },
  };
  const store: PublishStore = {
    load: async () => ctx,
    claimPost: async (row) => {
      const existing = posts.get(row.idempotencyKey);
      if (existing) return { inserted: false, existing };
      posts.set(row.idempotencyKey, { ...row, bufferPostId: null, status: "queued", error: null });
      return { inserted: true };
    },
    updatePost: async (key, patch) => {
      posts.set(key, { ...posts.get(key)!, ...patch });
    },
    setDraftStatus: async (_id, status, extra = {}) => {
      Object.assign(draft, { status, ...extra });
    },
  };
  return { store, posts, draft };
}

type Vars = { input?: Record<string, unknown> } & Record<string, unknown>;

function makeGql(createPost: (input: Record<string, unknown>) => unknown = (i) => ({ post: { id: `bp_${i.channelId}` } })) {
  return vi.fn(async (_userId: string, query: string, vars: Vars = {}) => {
    if (query === TAGS_QUERY) return { tagsV2: { edges: [{ node: { id: "tag_bl", name: "build-log" } }] } };
    if (query === CREATE_TAG_MUTATION) return { createTag: { tag: { id: "tag_new" } } };
    if (query === CREATE_POST_MUTATION) return { createPost: createPost(vars.input!) };
    throw new Error(`unexpected query ${query}`);
  });
}

const createPostInputs = (gql: ReturnType<typeof makeGql>) =>
  gql.mock.calls.filter((c) => c[1] === CREATE_POST_MUTATION).map((c) => (c[2] as Vars).input!);

describe("publishDraft", () => {
  it("creates one Buffer post per channel with the exact input and stores the ids", async () => {
    const { store, posts, draft } = makeStore();
    const gql = makeGql();

    const res = await publishDraft("d1", "next_best_slot", {}, { store, gql, tagCache: new Map() });

    const inputs = createPostInputs(gql);
    expect(inputs).toEqual([
      { channelId: "ch_x", text: "x text", mode: "addToQueue", schedulingType: "automatic", assets: [], needsApproval: false, tagIds: ["tag_bl"] },
      { channelId: "ch_li", text: "edited li text", mode: "addToQueue", schedulingType: "automatic", assets: [], needsApproval: false, tagIds: ["tag_bl"] },
    ]);
    expect([...posts.values()].map((p) => [p.channelId, p.bufferPostId, p.status])).toEqual([
      ["ch_x", "bp_ch_x", "queued"],
      ["ch_li", "bp_ch_li", "queued"],
    ]);
    expect(draft.status).toBe("posted");
    expect(res.status).toBe("posted");
  });

  it("is idempotent: a second call does not post again", async () => {
    const { store } = makeStore();
    const gql = makeGql();
    const deps = { store, gql, tagCache: new Map() };

    await publishDraft("d1", "now", {}, deps);
    const second = await publishDraft("d1", "now", {}, deps);

    expect(createPostInputs(gql)).toHaveLength(2);
    expect(second.results.every((r) => r.status === "skipped")).toBe(true);
  });

  it("maps now to shareNow (sent) and a fixed time to customScheduled with dueAt", async () => {
    const at = new Date("2026-11-09T09:00:00Z");
    const a = makeStore();
    const gqlNow = makeGql();
    await publishDraft("d1", "now", {}, { store: a.store, gql: gqlNow, tagCache: new Map() });
    expect(createPostInputs(gqlNow)[0].mode).toBe("shareNow");
    expect([...a.posts.values()][0].status).toBe("sent");

    const b = makeStore();
    const gqlAt = makeGql();
    await publishDraft("d1", { at }, {}, { store: b.store, gql: gqlAt, tagCache: new Map() });
    expect(createPostInputs(gqlAt)[0]).toMatchObject({ mode: "customScheduled", dueAt: at.toISOString() });
  });

  it("retries once with addToQueue when Buffer rejects a past dueAt", async () => {
    const { store, posts } = makeStore();
    const gql = makeGql((input) =>
      input.mode === "customScheduled" ? { message: "dueAt must be in the future" } : { post: { id: `bp_${input.channelId}` } },
    );

    await publishDraft("d1", { at: new Date("2020-01-01T00:00:00Z") }, {}, { store, gql, tagCache: new Map() });

    const inputs = createPostInputs(gql);
    expect(inputs.map((i) => i.mode)).toEqual(["customScheduled", "addToQueue", "customScheduled", "addToQueue"]);
    expect(inputs[1].dueAt).toBeUndefined();
    expect([...posts.values()].every((p) => p.bufferPostId?.startsWith("bp_"))).toBe(true);
  });

  it("saves to Buffer drafts in review mode draft", async () => {
    const { store } = makeStore({ mode: "draft" });
    const gql = makeGql();
    await publishDraft("d1", "next_best_slot", {}, { store, gql, tagCache: new Map() });
    expect(createPostInputs(gql).every((i) => i.saveToDraft === true)).toBe(true);
  });

  it("never calls Buffer for a demo project and simulates success", async () => {
    const { store, posts, draft } = makeStore({ isDemo: true });
    const gql = makeGql();
    await publishDraft("d1", "next_best_slot", {}, { store, gql, tagCache: new Map() });
    expect(gql).not.toHaveBeenCalled();
    expect([...posts.values()].every((p) => p.bufferPostId?.startsWith("demo_"))).toBe(true);
    expect(draft.status).toBe("posted");
  });

  it("fails the draft without posting to a disconnected channel", async () => {
    const { store, posts, draft } = makeStore({ channels: [channel("ch_x", "twitter", { isDisconnected: true }), channel("ch_li", "linkedin")] });
    const gql = makeGql();
    await publishDraft("d1", "next_best_slot", {}, { store, gql, tagCache: new Map() });
    expect(createPostInputs(gql).map((i) => i.channelId)).toEqual(["ch_li"]);
    expect([...posts.values()].find((p) => p.channelId === "ch_x")).toMatchObject({ status: "error" });
    expect(draft.status).toBe("failed");
    expect(draft.rejectReason).toMatch(/reconnect/i);
  });

  it("leaves the draft approved with a retry time on rate limits, then retries on the next call", async () => {
    const { store, posts, draft } = makeStore();
    let limited = true;
    const gql = makeGql((input) => {
      if (limited) throw new RateLimitError(120);
      return { post: { id: `bp_${input.channelId}` } };
    });
    const deps = { store, gql, tagCache: new Map() };

    await publishDraft("d1", "next_best_slot", {}, deps);
    expect(draft.status).toBe("approved");
    expect([...posts.values()][0]).toMatchObject({ status: "queued", error: "retry_after:120", bufferPostId: null });

    limited = false;
    await publishDraft("d1", "next_best_slot", {}, deps);
    expect(draft.status).toBe("posted");
    expect([...posts.values()].every((p) => p.bufferPostId)).toBe(true);
  });

  it("posts without tags when the build-log tag cannot be created", async () => {
    const { store } = makeStore();
    const gql = vi.fn(async (_u: string, query: string, vars: Vars = {}) => {
      if (query === TAGS_QUERY) return { tagsV2: { edges: [] } };
      if (query === CREATE_TAG_MUTATION) return { createTag: { message: "Limit reached" } };
      return { createPost: { post: { id: `bp_${vars.input!.channelId}` } } };
    });
    await publishDraft("d1", "next_best_slot", {}, { store, gql, tagCache: new Map() });
    const inputs = gql.mock.calls.filter((c) => c[1] === CREATE_POST_MUTATION).map((c) => (c[2] as Vars).input!);
    expect(inputs.every((i) => !("tagIds" in i))).toBe(true);
  });
});

describe("maybeAutoPublish", () => {
  const passing = {
    channels: { x: { fixed: [], violations: [], blocked: false } },
    voiceScore: { x: 0.9 },
    fallback: false,
  };
  const run = async (mode: string, gate: Record<string, unknown> = passing) => {
    const publish = vi.fn(async () => ({ status: "posted", results: [] }));
    const noteHeld = vi.fn(async () => {});
    const store = { load: async () => ({ status: "pending", gate, userDefaults: {}, projectConfig: { review: { mode } } }), noteHeld };
    const out = await maybeAutoPublish("d1", { store, publish });
    return { out, publish, noteHeld };
  };

  it("publishes to the next slot in auto mode when every check passes", async () => {
    const { out, publish } = await run("auto");
    expect(out.action).toBe("published");
    expect(publish).toHaveBeenCalledWith("d1", "next_best_slot");
  });

  it("holds the draft in the inbox on a low voice score or a violation", async () => {
    const low = await run("auto", { ...passing, voiceScore: { x: 0.5 } });
    expect(low.publish).not.toHaveBeenCalled();
    expect(low.noteHeld).toHaveBeenCalledWith("d1", expect.stringContaining("voice score"));

    const violated = await run("auto", { ...passing, channels: { x: { fixed: [], violations: [{ kind: "length", detail: "300/280" }], blocked: false } } });
    expect(violated.out.action).toBe("held");
  });

  it("saves to Buffer drafts in draft mode and does nothing in inbox mode", async () => {
    const draft = await run("draft");
    expect(draft.publish).toHaveBeenCalledWith("d1", "next_best_slot", { saveToDraft: true });
    const inbox = await run("inbox");
    expect(inbox.publish).not.toHaveBeenCalled();
  });
});
