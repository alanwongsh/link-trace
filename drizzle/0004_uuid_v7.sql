-- UUID v7 (RFC 9562): 48-bit Unix milliseconds, then random bits. New rows sort by creation time,
-- which keeps primary key indexes compact as clicks grow. Postgres 18 ships uuidv7(); these
-- functions are for Postgres 17 and earlier and are safe to keep after an upgrade.
--
-- Built from gen_random_uuid(): the first 6 bytes become the timestamp, and setting bits 52 and 53
-- turns version 4 (0100) into version 7 (0111). The variant bits are already correct.
CREATE OR REPLACE FUNCTION uuid_v7_at(ts timestamptz) RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$
  SELECT encode(
    set_bit(
      set_bit(
        overlay(
          uuid_send(gen_random_uuid())
          PLACING substring(int8send(floor(extract(epoch FROM ts) * 1000)::bigint) FROM 3)
          FROM 1 FOR 6
        ),
        52, 1
      ),
      53, 1
    ),
    'hex'
  )::uuid
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION uuid_v7() RETURNS uuid
LANGUAGE sql VOLATILE PARALLEL SAFE
AS $$ SELECT uuid_v7_at(clock_timestamp()) $$;
--> statement-breakpoint
-- Re-key existing links and clicks to v7, timestamped from when they were created or clicked, so
-- old and new rows sort the same way. Only v4 ids are touched, so this is safe to re-run.
CREATE TEMP TABLE link_id_map ON COMMIT DROP AS
  SELECT id AS old_id, uuid_v7_at(created_at) AS new_id
  FROM links
  WHERE substring(id::text, 15, 1) = '4';
--> statement-breakpoint
ALTER TABLE clicks DROP CONSTRAINT clicks_link_id_fkey;
--> statement-breakpoint
UPDATE links SET id = m.new_id FROM link_id_map m WHERE links.id = m.old_id;
--> statement-breakpoint
UPDATE clicks SET link_id = m.new_id FROM link_id_map m WHERE clicks.link_id = m.old_id;
--> statement-breakpoint
ALTER TABLE clicks ADD CONSTRAINT clicks_link_id_fkey
  FOREIGN KEY (link_id) REFERENCES public.links (id) ON DELETE CASCADE ON UPDATE NO ACTION;
--> statement-breakpoint
UPDATE clicks SET id = uuid_v7_at(clicked_at) WHERE substring(id::text, 15, 1) = '4';
