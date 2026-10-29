ALTER TABLE "jobs" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "verification_status" text;--> statement-breakpoint
ALTER TABLE "jobs" ADD COLUMN "verification_reason" text;