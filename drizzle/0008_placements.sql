CREATE TABLE "placement_values" (
	"placement_id" uuid NOT NULL,
	"parameter_id" uuid NOT NULL,
	"option_id" uuid,
	"value" text NOT NULL,
	CONSTRAINT "placement_values_pkey" PRIMARY KEY("placement_id","parameter_id")
);
--> statement-breakpoint
CREATE TABLE "placements" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"link_id" uuid NOT NULL,
	"code" text NOT NULL,
	"name" text,
	"legacy_tag" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "placements_code_format" CHECK ("placements"."code" ~ '^[a-z0-9]{6,16}$')
);
--> statement-breakpoint
ALTER TABLE "clicks" ADD COLUMN "placement_id" uuid;--> statement-breakpoint
ALTER TABLE "placement_values" ADD CONSTRAINT "placement_values_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_values" ADD CONSTRAINT "placement_values_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "public"."tracking_parameters"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placement_values" ADD CONSTRAINT "placement_values_option_id_fkey" FOREIGN KEY ("option_id") REFERENCES "public"."tracking_parameter_options"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "placements" ADD CONSTRAINT "placements_link_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "placement_values_parameter_value_idx" ON "placement_values" USING btree ("parameter_id","value");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_code_key" ON "placements" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "placements_link_legacy_tag_key" ON "placements" USING btree ("link_id","legacy_tag");--> statement-breakpoint
ALTER TABLE "clicks" ADD CONSTRAINT "clicks_placement_id_fkey" FOREIGN KEY ("placement_id") REFERENCES "public"."placements"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "clicks_placement_id_idx" ON "clicks" USING btree ("placement_id");--> statement-breakpoint
-- Same protection as the other tables: Supabase's public API roles get nothing.
ALTER TABLE "placements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "placement_values" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON "placements", "placement_values" FROM anon, authenticated;
	END IF;
END $$;
