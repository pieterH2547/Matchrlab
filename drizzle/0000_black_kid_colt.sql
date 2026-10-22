CREATE TYPE "public"."ats" AS ENUM('jobtoolz', 'recruitee', 'teamtailor', 'workable', 'talentfinder', 'smartrecruiters', 'greenhouse', 'lever', 'personio', 'unknown', 'none');--> statement-breakpoint
CREATE TYPE "public"."job_source" AS ENUM('company_site', 'vdab', 'adzuna', 'brave');--> statement-breakpoint
CREATE TYPE "public"."run_status" AS ENUM('profile', 'jobboards', 'discover', 'crawl', 'score', 'done', 'failed');--> statement-breakpoint
CREATE TABLE "companies" (
	"id" serial PRIMARY KEY NOT NULL,
	"domain" text NOT NULL,
	"name" text,
	"jobs_url" text,
	"ats" "ats" DEFAULT 'unknown' NOT NULL,
	"last_crawled_at" timestamp with time zone,
	"open_jobs_count" integer DEFAULT 0 NOT NULL,
	"notes" text,
	CONSTRAINT "companies_domain_unique" UNIQUE("domain")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" integer,
	"source" "job_source" NOT NULL,
	"external_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"location" text,
	"description_text" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"raw" jsonb,
	CONSTRAINT "jobs_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"job_id" integer NOT NULL,
	"score" integer NOT NULL,
	"reason" text NOT NULL,
	"rank" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"run_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_cache" (
	"url" text PRIMARY KEY NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"content_text" text,
	"status_code" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"author" text NOT NULL,
	"candidate_name" text,
	"cv_text" text,
	"free_text" text,
	"profile" jsonb,
	"status" "run_status" DEFAULT 'profile' NOT NULL,
	"cost_estimate_eur" real DEFAULT 0 NOT NULL,
	"thread_id" text NOT NULL,
	"state" jsonb DEFAULT '{"steps":[]}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"month" text PRIMARY KEY NOT NULL,
	"brave_queries" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "jobs_last_seen_idx" ON "jobs" USING btree ("last_seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "matches_run_job_idx" ON "matches" USING btree ("run_id","job_id");--> statement-breakpoint
CREATE INDEX "runs_thread_idx" ON "runs" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "runs_created_idx" ON "runs" USING btree ("created_at");