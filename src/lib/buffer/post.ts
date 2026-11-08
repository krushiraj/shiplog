import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { drafts, posts, projects, users, type CachedChannel } from "@/db/schema";
import { postMetadata, resolveTargets } from "@/lib/channels";
import { resolveConfig, type PartialConfig } from "@/lib/config";
import { BudgetError, RateLimitError, bufferGql } from "./client";
import {
  CREATE_POST_MUTATION,
  CREATE_TAG_MUTATION,
  TAGS_QUERY,
  type CreatePostResult,
  type CreateTagResult,
  type TagsResult,
} from "./queries";

export type When = "now" | "next_best_slot" | { at: Date };

export type PostRow = {
  draftId: string;
  channelId: string;
  idempotencyKey: string;
  bufferPostId: string | null;
  status: string; // queued | sent | error
  error: string | null;
};

export type PublishContext = {
  draft: {
    id: string;
    status: string;
    variants: Record<string, string>;
    finalText: Record<string, string> | null;
    gate: Record<string, unknown> | null;
  };
  project: { id: string; isDemo: boolean; userDefaults: Record<string, unknown>; projectConfig: Record<string, unknown> };
  user: { id: string; organizationId: string | null; channels: CachedChannel[] | null };
};

type ClaimRow = Pick<PostRow, "draftId" | "channelId" | "idempotencyKey">;

export interface PublishStore {
  load(draftId: string): Promise<PublishContext | null>;
  /** insert … on conflict (idempotency_key) do nothing; returns the existing row on conflict. */
  claimPost(row: ClaimRow): Promise<{ inserted: true } | { inserted: false; existing: PostRow }>;
  updatePost(idempotencyKey: string, patch: Partial<Pick<PostRow, "bufferPostId" | "status" | "error">>): Promise<void>;
  setDraftStatus(draftId: string, status: string, extra?: { rejectReason?: string | null; scheduledFor?: Date | null }): Promise<void>;
}

export type Gql = (userId: string, query: string, variables?: Record<string, unknown>) => Promise<unknown>;

export type PublishDeps = {
  store?: PublishStore;
  gql?: Gql;
  tagCache?: Map<string, string>;
  now?: () => Date;
};

export type ChannelResult = {
  channelId: string;
  status: "queued" | "sent" | "skipped" | "error" | "retry";
  bufferPostId?: string;
  error?: string;
};

const TAG_NAME = "build-log";
const TAG_COLOR = "#4F46E5";
const processTagCache = new Map<string, string>();

const PAST_DUE = /past|future|due ?at|due date/i;
const DISCONNECTED = /disconnect|reconnect|locked/i;

export const idempotencyKey = (draftId: string, channelId: string) =>
  createHash("sha256").update(draftId + channelId).digest("hex");

async function ensureTag(gql: Gql, userId: string, org: string | null, cache: Map<string, string>): Promise<string | null> {
  if (!org) return null;
  const cached = cache.get(org);
  if (cached) return cached;
  try {
    const tags = (await gql(userId, TAGS_QUERY, { org })) as TagsResult;
    let id = tags.tagsV2.edges.find((e) => e.node.name.toLowerCase() === TAG_NAME)?.node.id ?? null;
    if (!id) {
      const res = (await gql(userId, CREATE_TAG_MUTATION, { org, name: TAG_NAME, color: TAG_COLOR })) as CreateTagResult;
      id = "tag" in res.createTag ? res.createTag.tag.id : null;
    }
    if (id) cache.set(org, id);
    return id;
  } catch {
    return null;
  }
}

const retryable = (row: PostRow) => !row.bufferPostId && (row.status === "error" || !!row.error?.startsWith("retry_after:"));

export async function publishDraft(
  draftId: string,
  when: When,
  opts: { saveToDraft?: boolean } = {},
  deps: PublishDeps = {},
): Promise<{ status: string; results: ChannelResult[] }> {
  const store = deps.store ?? drizzlePublishStore;
  const gql: Gql = deps.gql ?? ((userId, query, variables) => bufferGql(userId, query, variables));
  const tagCache = deps.tagCache ?? processTagCache;
  const now = (deps.now ?? (() => new Date()))();

  const ctx = await store.load(draftId);
  if (!ctx) throw new Error(`Draft ${draftId} not found`);
  const { draft, project, user } = ctx;
  if (["rejected", "expired"].includes(draft.status)) throw new Error(`Draft ${draftId} is ${draft.status}`);

  const config = resolveConfig(project.userDefaults as PartialConfig, project.projectConfig as PartialConfig);
  const cached = user.channels ?? [];
  const stored = (draft.gate?.targets as { channelId: string; key: string }[] | undefined) ?? null;
  const targets = stored ?? resolveTargets(config.channels, cached, config);
  const saveToDraft = opts.saveToDraft ?? config.review.mode === "draft";
  const mode = when === "now" ? "shareNow" : when === "next_best_slot" ? "addToQueue" : "customScheduled";
  const dueAt = typeof when === "object" ? when.at.toISOString() : undefined;
  const okStatus = mode === "shareNow" && !saveToDraft ? "sent" : "queued";

  let tagId: string | null | undefined;
  const results: ChannelResult[] = [];

  for (const { channelId, key } of targets) {
    const idemKey = idempotencyKey(draftId, channelId);
    const claim = await store.claimPost({ draftId, channelId, idempotencyKey: idemKey });
    if (!claim.inserted && !retryable(claim.existing)) {
      results.push({ channelId, status: "skipped" });
      continue;
    }
    const fail = async (error: string) => {
      await store.updatePost(idemKey, { status: "error", error });
      results.push({ channelId, status: "error", error });
    };

    const text = draft.finalText?.[key] ?? draft.variants[key];
    if (!text) {
      await fail(`No text for ${key}`);
      continue;
    }

    if (project.isDemo) {
      const bufferPostId = `demo_${idemKey.slice(0, 12)}`;
      await store.updatePost(idemKey, { bufferPostId, status: okStatus, error: null });
      results.push({ channelId, status: okStatus, bufferPostId });
      continue;
    }

    const channel = cached.find((c) => c.id === channelId);
    if (channel?.isDisconnected || channel?.isLocked) {
      await fail(`Reconnect ${channel.displayName ?? channel.name} in Buffer: the channel is ${channel.isLocked ? "locked" : "disconnected"}`);
      continue;
    }

    if (tagId === undefined) tagId = await ensureTag(gql, user.id, user.organizationId, tagCache);
    const metadata = channel ? postMetadata(channel.service) : undefined;
    const input = (m: string, due?: string) => ({
      channelId,
      text,
      mode: m,
      schedulingType: "automatic",
      assets: [],
      needsApproval: false,
      ...(due && { dueAt: due }),
      ...(saveToDraft && { saveToDraft: true }),
      ...(tagId && { tagIds: [tagId] }),
      ...(metadata && { metadata }),
    });

    try {
      let res = ((await gql(user.id, CREATE_POST_MUTATION, { input: input(mode, dueAt) })) as CreatePostResult).createPost;
      if ("message" in res && mode === "customScheduled" && PAST_DUE.test(res.message)) {
        res = ((await gql(user.id, CREATE_POST_MUTATION, { input: input("addToQueue") })) as CreatePostResult).createPost;
      }
      if ("message" in res) {
        await fail(DISCONNECTED.test(res.message) ? `Reconnect this channel in Buffer: ${res.message}` : res.message);
        continue;
      }
      await store.updatePost(idemKey, { bufferPostId: res.post.id, status: okStatus, error: null });
      results.push({ channelId, status: okStatus, bufferPostId: res.post.id });
    } catch (e) {
      if (e instanceof RateLimitError || e instanceof BudgetError) {
        const error = `retry_after:${e.retryAfter}`;
        await store.updatePost(idemKey, { status: "queued", error });
        results.push({ channelId, status: "retry", error });
      } else {
        await fail((e as Error).message);
      }
    }
  }

  if (results.every((r) => r.status === "skipped")) return { status: draft.status, results };
  const errors = results.filter((r) => r.status === "error").map((r) => r.error!);
  let status: string;
  if (results.some((r) => r.status === "retry")) {
    status = "approved";
    await store.setDraftStatus(draftId, status);
  } else if (errors.length) {
    status = "failed";
    await store.setDraftStatus(draftId, status, { rejectReason: errors.join("; ") });
  } else {
    status = "posted";
    await store.setDraftStatus(draftId, status, { scheduledFor: typeof when === "object" ? when.at : now });
  }
  return { status, results };
}

export const drizzlePublishStore: PublishStore = {
  async load(draftId) {
    const [row] = await db
      .select({ draft: drafts, project: projects, user: users })
      .from(drafts)
      .innerJoin(projects, eq(projects.id, drafts.projectId))
      .innerJoin(users, eq(users.id, projects.userId))
      .where(eq(drafts.id, draftId));
    if (!row) return null;
    return {
      draft: row.draft,
      project: { id: row.project.id, isDemo: row.project.isDemo, userDefaults: row.user.defaults, projectConfig: row.project.config },
      user: { id: row.user.id, organizationId: row.user.organizationId, channels: row.user.channels },
    };
  },
  async claimPost(row) {
    const inserted = await db
      .insert(posts)
      .values({ ...row, status: "queued" })
      .onConflictDoNothing({ target: posts.idempotencyKey })
      .returning({ id: posts.id });
    if (inserted.length) return { inserted: true };
    const [existing] = await db.select().from(posts).where(eq(posts.idempotencyKey, row.idempotencyKey));
    return { inserted: false, existing };
  },
  async updatePost(key, patch) {
    await db.update(posts).set(patch).where(eq(posts.idempotencyKey, key));
  },
  async setDraftStatus(draftId, status, extra = {}) {
    await db.update(drafts).set({ status, ...extra }).where(eq(drafts.id, draftId));
  },
};
