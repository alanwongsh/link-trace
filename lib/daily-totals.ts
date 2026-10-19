import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { after } from "next/server";
import type { JobPayloads } from "@/lib/jobs/catalog";
import { enqueue } from "@/lib/queue";

// Redoes daily totals in the links' current timezone after the response: when a workspace changes
// timezone, or a link moves to another workspace. Until it finishes, the old rows count on their
// old days.
export function queueRebuild(target: JobPayloads["rebuild-totals"]): void {
  after(() => enqueue("rebuild-totals", target).catch((error) => console.error("rebuild-totals failed:", error)));
}

// The common start of every count the app shows: for the links that match `linkFilter` (a
// condition on l, the link, and w, its workspace), finished days come from the daily tables and
// later clicks from clicks, so a page reads about one day of clicks however old the links are.
// Days are local dates in each link's workspace timezone. Bots are left out of everything except
// bot_clicks. visitors and ips are distinct per day, then summed.
//
// CTEs it defines, each with link_id, day and today (the link's local today):
//   lz             link_id, tz, through, today
//   link_days      clicks, visitors, ips, bot_clicks
//   dim_days       dim ('tag' | 'country' | 'referrer'), value ('' for none), clicks, visitors
//   placement_days placement_id (null for the main link), clicks, visitors
// Unused CTEs are not run. Use as: sql`with ${dailyScope(filter)} select … from link_days …`.
export function dailyScope(linkFilter: SQL): SQL {
  return sql`
    lz as (
      select l.id as link_id, w.timezone as tz,
        coalesce(p.through, date '1970-01-01') as through,
        (now() at time zone w.timezone)::date as today
      from links l
      join workspaces w on w.id = l.workspace_id
      left join rollup_progress p on p.name = 'daily:' || w.timezone
      where ${linkFilter}
    ),
    tail as (
      select c.link_id, c.placement_id, c.visitor_id, c.ip, c.is_bot, c.tag, c.country, c.referrer,
        (c.clicked_at at time zone lz.tz)::date as day, lz.today
      from clicks c join lz on lz.link_id = c.link_id
      where c.clicked_at >= ((lz.through + 1)::timestamp at time zone lz.tz)
    ),
    link_days as (
      select d.link_id, d.day, lz.today, d.clicks, d.visitors, d.ips, d.bot_clicks
      from click_daily_link d join lz on lz.link_id = d.link_id
      where d.day <= lz.through
      union all
      select link_id, day, today,
        count(*) filter (where not is_bot)::int,
        count(distinct visitor_id) filter (where not is_bot)::int,
        count(distinct ip) filter (where not is_bot)::int,
        count(*) filter (where is_bot)::int
      from tail group by link_id, day, today
    ),
    dim_days as (
      select d.link_id, d.day, lz.today, d.dim, d.value, d.clicks, d.visitors
      from click_daily_dim d join lz on lz.link_id = d.link_id
      where d.day <= lz.through
      union all
      select t.link_id, t.day, t.today, v.dim, v.value, count(*)::int, count(distinct t.visitor_id)::int
      from tail t
      cross join lateral (values ('tag', coalesce(t.tag, '')), ('country', coalesce(t.country, '')), ('referrer', coalesce(t.referrer, ''))) v(dim, value)
      where not t.is_bot
      group by 1, 2, 3, 4, 5
    ),
    placement_days as (
      select d.link_id, d.day, lz.today, d.placement_id, d.clicks, d.visitors
      from click_daily d join lz on lz.link_id = d.link_id
      where d.day <= lz.through
      union all
      select link_id, day, today, placement_id, count(*)::int, count(distinct visitor_id)::int
      from tail where not is_bot group by link_id, day, today, placement_id
    )`;
}

// Rows within the last `days` local days including today, or all of them. For a CTE row r.
export function withinDays(days: number | null, alias = ""): SQL {
  const col = (name: string) => sql.raw(alias ? `${alias}.${name}` : name);
  return days === null ? sql`true` : sql`${col("day")} >= ${col("today")} - ${days - 1}::int`;
}
