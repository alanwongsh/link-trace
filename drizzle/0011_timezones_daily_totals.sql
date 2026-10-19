CREATE TABLE "click_daily_dim" (
	"link_id" uuid NOT NULL,
	"day" date NOT NULL,
	"dim" text NOT NULL,
	"value" text NOT NULL,
	"clicks" integer NOT NULL,
	"visitors" integer NOT NULL,
	CONSTRAINT "click_daily_dim_dim_check" CHECK ("click_daily_dim"."dim" in ('tag', 'country', 'referrer'))
);
--> statement-breakpoint
CREATE TABLE "click_daily_link" (
	"link_id" uuid NOT NULL,
	"day" date NOT NULL,
	"clicks" integer NOT NULL,
	"visitors" integer NOT NULL,
	"ips" integer NOT NULL,
	"bot_clicks" integer NOT NULL
);
--> statement-breakpoint
ALTER TABLE "workspaces" ADD COLUMN "timezone" text DEFAULT 'Asia/Kuala_Lumpur' NOT NULL;--> statement-breakpoint
ALTER TABLE "click_daily_dim" ADD CONSTRAINT "click_daily_dim_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "click_daily_link" ADD CONSTRAINT "click_daily_link_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "click_daily_dim_link_day_idx" ON "click_daily_dim" USING btree ("link_id","dim","day");--> statement-breakpoint
CREATE INDEX "click_daily_link_link_day_idx" ON "click_daily_link" USING btree ("link_id","day");--> statement-breakpoint
-- Days are now local dates in each workspace's timezone, so the UTC totals from 0010 are dropped
-- and rebuilt by the click-rollup job, one timezone at a time (rollup_progress "daily:<zone>").
-- Until it runs, pages read the same numbers from clicks. Derived rows only; clicks are untouched.
TRUNCATE "click_daily";--> statement-breakpoint
DELETE FROM "rollup_progress" WHERE "name" = 'click_daily';--> statement-breakpoint
-- Same protection as the other tables: Supabase's public API roles get nothing.
ALTER TABLE "click_daily_link" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "click_daily_dim" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON "click_daily_link", "click_daily_dim" FROM anon, authenticated;
	END IF;
END $$;