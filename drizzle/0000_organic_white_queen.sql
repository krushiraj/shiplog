CREATE TABLE "api_budget" (
	"window" text PRIMARY KEY NOT NULL,
	"used" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "buffer_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"access_token_enc" text NOT NULL,
	"refresh_token_enc" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"refreshing_until" timestamp
);
--> statement-breakpoint
CREATE TABLE "change_cards" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"what" text NOT NULL,
	"why" text,
	"why_inferred" boolean DEFAULT false NOT NULL,
	"how" text,
	"impact" text,
	"significance" integer NOT NULL,
	"open_question" text,
	"answer" text,
	"cancelled" boolean DEFAULT false NOT NULL,
	"occurred_at" timestamp NOT NULL,
	CONSTRAINT "change_cards_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "demo_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"ai_calls" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "drafts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"trigger" text NOT NULL,
	"card_ids" jsonb NOT NULL,
	"variants" jsonb NOT NULL,
	"final_text" jsonb,
	"gate" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"reject_reason" text,
	"scheduled_for" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"delivery_id" text NOT NULL,
	"repo_full_name" text NOT NULL,
	"kind" text NOT NULL,
	"ref" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp NOT NULL,
	"processed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "github_installations" (
	"installation_id" integer PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"account_login" text NOT NULL,
	"suspended" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"draft_id" uuid NOT NULL,
	"channel_id" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"buffer_post_id" text,
	"status" text NOT NULL,
	"error" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "posts_idempotency_key_unique" UNIQUE("idempotency_key")
);
--> statement-breakpoint
CREATE TABLE "project_repos" (
	"project_id" uuid NOT NULL,
	"repo_full_name" text NOT NULL,
	"installation_id" integer NOT NULL,
	"overrides" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "project_repos_project_id_repo_full_name_pk" PRIMARY KEY("project_id","repo_full_name")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"brief" jsonb,
	"last_digest_at" timestamp,
	"claimed_until" timestamp,
	"paused" boolean DEFAULT false NOT NULL,
	"is_demo" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buffer_account_id" text NOT NULL,
	"email" text,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"organization_id" text,
	"channels" jsonb,
	"defaults" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_buffer_account_id_unique" UNIQUE("buffer_account_id")
);
--> statement-breakpoint
CREATE TABLE "voice_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"register" text NOT NULL,
	"dna" jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "voice_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"register" text,
	"kind" text NOT NULL,
	"rule" text NOT NULL,
	"pattern" text,
	"sightings" integer DEFAULT 1 NOT NULL,
	"active" boolean DEFAULT false NOT NULL,
	"source_draft_id" uuid,
	"last_seen_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "buffer_tokens" ADD CONSTRAINT "buffer_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_cards" ADD CONSTRAINT "change_cards_event_id_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."events"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_installations" ADD CONSTRAINT "github_installations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_draft_id_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_repos" ADD CONSTRAINT "project_repos_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_profiles" ADD CONSTRAINT "voice_profiles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_rules" ADD CONSTRAINT "voice_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_repo_kind_ref" ON "events" USING btree ("repo_full_name","kind","ref");