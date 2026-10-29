ALTER TYPE "public"."job_source" ADD VALUE 'web';--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "address" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "category" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "lat" real;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "lng" real;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "verification" text;