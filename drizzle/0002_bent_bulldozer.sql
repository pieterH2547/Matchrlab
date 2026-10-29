ALTER TYPE "public"."run_status" ADD VALUE 'signals' BEFORE 'done';--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "argument" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "risk" text;