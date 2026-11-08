CREATE TABLE "file_summaries" (
	"repo_full_name" text NOT NULL,
	"path" text NOT NULL,
	"blob_sha" text NOT NULL,
	"summary" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "file_summaries_repo_full_name_path_blob_sha_pk" PRIMARY KEY("repo_full_name","path","blob_sha")
);
--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "brief_status" jsonb;