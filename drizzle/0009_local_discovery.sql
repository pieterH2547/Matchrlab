CREATE TABLE "search_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"results" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "discovered_via" text;