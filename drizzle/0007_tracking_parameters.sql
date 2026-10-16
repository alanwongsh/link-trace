CREATE TABLE "tracking_parameter_options" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"parameter_id" uuid NOT NULL,
	"value" text NOT NULL,
	"label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "tracking_parameters" (
	"id" uuid PRIMARY KEY DEFAULT uuid_v7() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"description" text,
	"field_type" text NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone,
	CONSTRAINT "tracking_parameters_key_format" CHECK ("tracking_parameters"."key" ~ '^[a-z][a-z0-9_]{0,39}$'),
	CONSTRAINT "tracking_parameters_field_type_check" CHECK ("tracking_parameters"."field_type" in ('text', 'dropdown'))
);
--> statement-breakpoint
ALTER TABLE "tracking_parameter_options" ADD CONSTRAINT "tracking_parameter_options_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_parameter_options" ADD CONSTRAINT "tracking_parameter_options_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_parameter_options" ADD CONSTRAINT "tracking_parameter_options_parameter_id_fkey" FOREIGN KEY ("parameter_id") REFERENCES "public"."tracking_parameters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_parameters" ADD CONSTRAINT "tracking_parameters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_parameters" ADD CONSTRAINT "tracking_parameters_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_parameters" ADD CONSTRAINT "tracking_parameters_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_parameter_options_value" ON "tracking_parameter_options" USING btree ("parameter_id",lower("value"));--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_parameters_workspace_key" ON "tracking_parameters" USING btree ("workspace_id","key");--> statement-breakpoint
-- Same protection as the other tables: Supabase's public API roles get nothing.
ALTER TABLE "tracking_parameters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tracking_parameter_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON "tracking_parameters", "tracking_parameter_options" FROM anon, authenticated;
	END IF;
END $$;
