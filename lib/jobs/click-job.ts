// Saves queued clicks in one statement per batch. Plain SQL so the worker can run it directly.
import type { Sql } from "postgres";
import type { ClickJob } from "./catalog.ts";

// Same rules as direct saving (insertClick in lib/data.ts): a tag visit without a placement counts
// for the placement made from that tag. on conflict skips clicks a retried batch already saved,
// and clicks whose link was deleted while they waited are dropped. JSON goes as text, then cast,
// so it reads the same through the app's client (whose JSON encoding drizzle turns off) and others.
export async function insertClicks(sql: Sql, clicks: ClickJob[]): Promise<number> {
  if (clicks.length === 0) return 0;
  const result = await sql`
    insert into clicks (id, link_id, visitor_id, ip, user_agent, referrer, country, region, city, is_bot, tag, placement_id, clicked_at)
    select c.id, c."linkId", c."visitorId", c.ip, c."userAgent", c.referrer, c.country, c.region, c.city, c."isBot", c.tag,
      coalesce(
        (select p.id from placements p where p.id = c."placementId"),
        case when c."placementId" is null and c.tag is not null
          then (select p.id from placements p where p.link_id = c."linkId" and p.legacy_tag = c.tag) end
      ),
      c."clickedAt"
    from jsonb_to_recordset(${JSON.stringify(clicks)}::text::jsonb) as c(
      id uuid, "linkId" uuid, "visitorId" text, ip text, "userAgent" text, referrer text, country text, region text,
      city text, "isBot" boolean, tag text, "placementId" uuid, "clickedAt" timestamptz
    )
    where exists (select 1 from links l where l.id = c."linkId")
    on conflict (id) do nothing`;
  return result.count;
}
