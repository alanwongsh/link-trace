CREATE TABLE "click_daily" (
	"link_id" uuid NOT NULL,
	"placement_id" uuid,
	"day" date NOT NULL,
	"clicks" integer NOT NULL,
	"visitors" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rollup_progress" (
	"name" text PRIMARY KEY NOT NULL,
	"through" date NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "click_daily" ADD CONSTRAINT "click_daily_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_daily" ADD CONSTRAINT "click_daily_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "click_daily_link_day_idx" ON "click_daily" USING btree ("link_id","day");--> statement-breakpoint
CREATE INDEX "clicks_clicked_at_idx" ON "clicks" USING btree ("clicked_at");--> statement-breakpoint
-- Backfill every finished UTC day once; the click-rollup job keeps it current from here.
-- Only adds rows; clicks are read, never changed.
INSERT INTO "click_daily" ("link_id", "placement_id", "day", "clicks", "visitors")
SELECT "link_id", "placement_id", ("clicked_at" AT TIME ZONE 'utc')::date, count(*)::int, count(DISTINCT "visitor_id")::int
FROM "clicks"
WHERE NOT "is_bot" AND "clicked_at" < (date_trunc('day', now() AT TIME ZONE 'utc') AT TIME ZONE 'utc')
GROUP BY 1, 2, 3;--> statement-breakpoint
INSERT INTO "rollup_progress" ("name", "through") VALUES ('click_daily', (now() AT TIME ZONE 'utc')::date - 1);--> statement-breakpoint
-- Same protection as the other tables: Supabase's public API roles get nothing.
ALTER TABLE "click_daily" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rollup_progress" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON "click_daily", "rollup_progress" FROM anon, authenticated;
	END IF;
END $$;