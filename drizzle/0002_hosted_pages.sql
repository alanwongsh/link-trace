ALTER TABLE "links" ALTER COLUMN "url" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "kind" text DEFAULT 'redirect' NOT NULL;--> statement-breakpoint
ALTER TABLE "links" ADD COLUMN "html" text;--> statement-breakpoint
ALTER TABLE "links" ADD CONSTRAINT "links_kind_target" CHECK (("links"."kind" = 'redirect' and "links"."url" is not null) or ("links"."kind" = 'page' and "links"."html" is not null));