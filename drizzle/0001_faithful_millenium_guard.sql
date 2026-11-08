ALTER TABLE "github_installations" ADD COLUMN "github_user_id" integer;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "github_login" text;--> statement-breakpoint
ALTER TABLE "github_installations" ADD COLUMN "verified_at" timestamp;