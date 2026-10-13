-- Idempotent on purpose: databases set up with the old supabase/schema.sql already have these tables.
CREATE TABLE IF NOT EXISTS "links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"url" text NOT NULL,
	"title" text,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "links_slug_key" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN IF NOT EXISTS "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'links_tags_len') THEN
		ALTER TABLE "links" ADD CONSTRAINT "links_tags_len" CHECK (cardinality("links"."tags") <= 12);
	END IF;
END $$;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "clicks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"link_id" uuid NOT NULL,
	"visitor_id" text NOT NULL,
	"ip" text,
	"user_agent" text,
	"referrer" text,
	"country" text,
	"region" text,
	"city" text,
	"is_bot" boolean DEFAULT false NOT NULL,
	"tag" text,
	"clicked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN IF NOT EXISTS "tag" text;--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'clicks_link_id_fkey') THEN
		ALTER TABLE "clicks" ADD CONSTRAINT "clicks_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;
	END IF;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "clicks_link_id_clicked_at_idx" ON "clicks" USING btree ("link_id","clicked_at" DESC NULLS LAST);
