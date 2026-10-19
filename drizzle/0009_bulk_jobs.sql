CREATE TABLE "bulk_jobs" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"link_id" uuid NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"format" text DEFAULT 'png' NOT NULL,
	"rows" jsonb NOT NULL,
	"total" integer NOT NULL,
	"processed" integer DEFAULT 0 NOT NULL,
	"base_url" text NOT NULL,
	"error" text,
	"zip" "bytea",
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	CONSTRAINT "bulk_jobs_status_check" CHECK ("bulk_jobs"."status" in ('queued', 'running', 'done', 'failed')),
	CONSTRAINT "bulk_jobs_format_check" CHECK ("bulk_jobs"."format" in ('png', 'svg'))
);
--> statement-breakpoint
ALTER TABLE "placements" ADD COLUMN "bulk_job_id" uuid;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bulk_jobs" ADD CONSTRAINT "bulk_jobs_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bulk_jobs_link_id_idx" ON "bulk_jobs" USING btree ("link_id","created_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_bulk_job_id_fkey" FOREIGN KEY ("bulk_job_id") REFERENCES "public"."bulk_jobs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "placements_bulk_job_id_idx" ON "placements" USING btree ("bulk_job_id");--> statement-breakpoint
-- Same protection as the other tables: Supabase's public API roles get nothing.
ALTER TABLE "bulk_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON "bulk_jobs" FROM anon, authenticated;
	END IF;
END $$;
