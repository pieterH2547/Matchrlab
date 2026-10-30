CREATE TABLE "registry_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"sector" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"enterprise_number" text,
	"name" text NOT NULL,
	"address" text,
	"postcode" text,
	"municipality" text,
	"website" text,
	"source" text NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text DEFAULT 'nieuw' NOT NULL,
	"error" text,
	"company_id" integer,
	"checked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "sector" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "enterprise_number" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "registry_source" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "imported_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "crawl_status" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "crawl_error" text;--> statement-breakpoint
ALTER TABLE "companies" ADD COLUMN "next_check_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "registry_entries" ADD CONSTRAINT "registry_entries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "registry_dedupe_idx" ON "registry_entries" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "registry_sector_idx" ON "registry_entries" USING btree ("sector","status");