ALTER TABLE "placements" ADD COLUMN "label_key" text;--> statement-breakpoint
-- The same string as labelKey() in lib/label-key.ts: "name=<name>|<parameter id>=<value>|…",
-- lower case, labels sorted (by parameter id, since a placement has one value per parameter).
UPDATE "placements" p SET "label_key" = 'name=' || lower(btrim(coalesce(p."name", ''))) || coalesce((
	SELECT string_agg('|' || v."parameter_id"::text || '=' || lower(v."value"), '' ORDER BY v."parameter_id"::text COLLATE "C")
	FROM "placement_values" v WHERE v."placement_id" = p."id"
), '');--> statement-breakpoint
-- Active duplicates made before the rule: the oldest of each keeps its key and the others get
-- none, so none is changed or deactivated and the index below can be built. Null keys are not
-- checked; deactivating the extra copies tidies them up.
UPDATE "placements" p SET "label_key" = NULL
FROM (
	SELECT "id", row_number() OVER (PARTITION BY "link_id", "label_key" ORDER BY "created_at", "id") AS n
	FROM "placements" WHERE "is_active"
) d
WHERE d."id" = p."id" AND d.n > 1;--> statement-breakpoint
CREATE UNIQUE INDEX "placements_active_label_key" ON "placements" USING btree ("link_id","label_key") WHERE "placements"."is_active";
