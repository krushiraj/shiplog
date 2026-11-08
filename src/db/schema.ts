import { pgTable, text, timestamp, integer, jsonb, boolean, uuid, uniqueIndex, primaryKey, numeric, index } from "drizzle-orm/pg-core";

export type CachedChannel = {
  id: string;
  name: string;
  displayName: string | null;
  service: string;
  avatar: string;
  isDisconnected: boolean;
  isLocked: boolean;
  isQueuePaused: boolean;
  timezone: string | null;
  type: string | null;
  descriptor: string | null;
};

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  bufferAccountId: text("buffer_account_id").notNull().unique(),
  email: text("email"),
  timezone: text("timezone").notNull().default("UTC"),
  organizationId: text("organization_id"),
  channels: jsonb("channels").$type<CachedChannel[]>(),
  defaults: jsonb("defaults").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const bufferTokens = pgTable("buffer_tokens", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  accessTokenEnc: text("access_token_enc").notNull(),
  refreshTokenEnc: text("refresh_token_enc").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  refreshingUntil: timestamp("refreshing_until"), // single-flight lock
});

export const githubInstallations = pgTable("github_installations", {
  installationId: integer("installation_id").primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "cascade" }),
  accountLogin: text("account_login").notNull(),
  suspended: boolean("suspended").notNull().default(false),
  // Set once GitHub user OAuth proved the user can access this installation; only verified rows are trusted.
  githubUserId: integer("github_user_id"),
  githubLogin: text("github_login"),
  verifiedAt: timestamp("verified_at"),
});

export const projects = pgTable("projects", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  brief: jsonb("brief").$type<Record<string, unknown>>(),
  briefStatus: jsonb("brief_status").$type<Record<string, unknown>>(), // see BriefBuildStatus in lib/brief/status
  lastDigestAt: timestamp("last_digest_at"),
  claimedUntil: timestamp("claimed_until"), // scheduler row lock
  paused: boolean("paused").notNull().default(false),
  isDemo: boolean("is_demo").notNull().default(false),
});

export const projectRepos = pgTable("project_repos", {
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  repoFullName: text("repo_full_name").notNull(),
  installationId: integer("installation_id").notNull(),
  overrides: jsonb("overrides").$type<Record<string, unknown>>().notNull().default({}),
}, (t) => [primaryKey({ columns: [t.projectId, t.repoFullName] })]);

export const events = pgTable("events", {
  id: uuid("id").primaryKey().defaultRandom(),
  deliveryId: text("delivery_id").notNull(),
  repoFullName: text("repo_full_name").notNull(),
  kind: text("kind").notNull(), // commit | pr_merged | release | issue_closed | tag
  ref: text("ref").notNull(), // sha, PR number, tag name...
  payload: jsonb("payload").notNull(),
  occurredAt: timestamp("occurred_at").notNull(),
  processedAt: timestamp("processed_at"),
}, (t) => [uniqueIndex("events_repo_kind_ref").on(t.repoFullName, t.kind, t.ref)]);

export const changeCards = pgTable("change_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: uuid("event_id").notNull().references(() => events.id, { onDelete: "cascade" }).unique(),
  repoFullName: text("repo_full_name").notNull(),
  what: text("what").notNull(),
  why: text("why"),
  whyInferred: boolean("why_inferred").notNull().default(false),
  how: text("how"),
  impact: text("impact"),
  significance: integer("significance").notNull(), // 0..3
  openQuestion: text("open_question"),
  answer: text("answer"),
  cancelled: boolean("cancelled").notNull().default(false),
  occurredAt: timestamp("occurred_at").notNull(),
});

export const drafts = pgTable("drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  projectId: uuid("project_id").notNull().references(() => projects.id, { onDelete: "cascade" }),
  trigger: text("trigger").notNull(), // digest | instant:<kind>
  cardIds: jsonb("card_ids").$type<string[]>().notNull(),
  variants: jsonb("variants").$type<Record<string, string>>().notNull(), // channelKey -> AI text
  finalText: jsonb("final_text").$type<Record<string, string>>(), // after user edits
  gate: jsonb("gate").$type<Record<string, unknown>>(),
  status: text("status").notNull().default("pending"), // pending|approved|posted|rejected|expired|snoozed|failed
  rejectReason: text("reject_reason"),
  scheduledFor: timestamp("scheduled_for"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const posts = pgTable("posts", {
  id: uuid("id").primaryKey().defaultRandom(),
  draftId: uuid("draft_id").notNull().references(() => drafts.id),
  channelId: text("channel_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  bufferPostId: text("buffer_post_id"),
  status: text("status").notNull(), // queued|sent|error
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const voiceProfiles = pgTable("voice_profiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id").references(() => projects.id, { onDelete: "cascade" }), // null = user-level
  register: text("register").notNull(), // linkedin | x-short | thread
  dna: jsonb("dna").$type<Record<string, unknown>>().notNull(),
});

export const voiceRules = pgTable("voice_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  projectId: uuid("project_id"),
  register: text("register"),
  kind: text("kind").notNull(), // never | prefer | format
  rule: text("rule").notNull(),
  pattern: text("pattern"), // optional regex for code-checkable rules
  sightings: integer("sightings").notNull().default(1),
  active: boolean("active").notNull().default(false),
  sourceDraftId: uuid("source_draft_id"),
  lastSeenAt: timestamp("last_seen_at").defaultNow().notNull(),
});

export const apiBudget = pgTable("api_budget", {
  window: text("window").primaryKey(), // e.g. "15m:2026-11-08T12:15", "24h:2026-11-08"
  used: integer("used").notNull().default(0),
});

export const demoSessions = pgTable("demo_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  aiCalls: integer("ai_calls").notNull().default(0),
});

/** One row per AI call (including skipped and failed ones), kept for cost history and estimate tuning. */
export const aiUsage = pgTable("ai_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  projectId: uuid("project_id"), // no FK: history outlives deleted projects
  projectName: text("project_name"),
  purpose: text("purpose").notNull(), // analyse|brief-files|brief|compose|voice-check|voice-extract|rule-proposal|regenerate|other
  model: text("model").notNull(),
  refType: text("ref_type"), // event | draft | card | project
  refId: text("ref_id"),
  estInputTokens: integer("est_input_tokens").notNull().default(0),
  estOutputTokens: integer("est_output_tokens").notNull().default(0),
  estCostUsd: numeric("est_cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  cacheSavingsUsd: numeric("cache_savings_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  latencyMs: integer("latency_ms").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  status: text("status").notNull(), // ok|retried|format_error|refused|error|skipped_budget
  errorMessage: text("error_message"),
  isDemo: boolean("is_demo").notNull().default(false),
}, (t) => [
  index("ai_usage_user_created").on(t.userId, t.createdAt),
  index("ai_usage_project_created").on(t.projectId, t.createdAt),
]);

/** File summaries for the project brief, keyed by blob SHA so a rebuild only re-summarises changed files. */
export const fileSummaries = pgTable("file_summaries", {
  repoFullName: text("repo_full_name").notNull(),
  path: text("path").notNull(),
  blobSha: text("blob_sha").notNull(),
  summary: text("summary").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [primaryKey({ columns: [t.repoFullName, t.path, t.blobSha] })]);
