CREATE TABLE "offices" (
	"id" serial PRIMARY KEY NOT NULL,
	"sector" text NOT NULL,
	"kind" text DEFAULT 'onbekend' NOT NULL,
	"dedupe_key" text NOT NULL,
	"name" text NOT NULL,
	"brand" text,
	"address" text,
	"postcode" text,
	"municipality" text,
	"lat" real,
	"lng" real,
	"geo_precision" text DEFAULT 'exact' NOT NULL,
	"website" text,
	"domain" text,
	"phone" text,
	"enterprise_number" text,
	"rating" real,
	"rating_count" integer,
	"category" text,
	"sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"company_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "offices" ADD CONSTRAINT "offices_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "offices_dedupe_idx" ON "offices" USING btree ("dedupe_key");--> statement-breakpoint
CREATE INDEX "offices_sector_idx" ON "offices" USING btree ("sector");--> statement-breakpoint
CREATE INDEX "offices_geo_idx" ON "offices" USING btree ("lat","lng");--> statement-breakpoint
CREATE INDEX "offices_domain_idx" ON "offices" USING btree ("domain");