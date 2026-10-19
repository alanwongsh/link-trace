import "server-only";

import { sql } from "drizzle-orm";
import { dailyScope, withinDays } from "@/lib/daily-totals";
import { getDb, type Db } from "@/lib/db";
import { REPORT_RANGES, type ReportRange } from "@/lib/report-periods";

function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

// Rows kept in the period's place and referrer lists.
const TOP_PLACES = 50;
const TOP_REFERRERS = 8;

export type OverviewTotals = { clicks: number; visitors: number; ips: number; botClicks: number };

export type LinkOverview = {
  totals: OverviewTotals;
  // The same length of time just before, for the change; null for all time.
  previous: OverviewTotals | null;
  // hour: today by hour; day: one bar per day of the period; month: all time by month.
  granularity: "hour" | "day" | "month";
  trend: { key: string; clicks: number }[];
  countries: { country: string; clicks: number }[];
  referrers: { referrer: string; clicks: number }[];
  // Labelled links with at least one human visit in the period, of all the link's active ones.
  labelledUsed: number;
  labelledActive: number;
};

// A link's numbers for one period (today, last 7/30/90 days or all time), counted in its
// workspace timezone from the daily totals. Only today's hourly trend reads clicks directly.
export async function loadOverview(linkId: string, range: ReportRange): Promise<LinkOverview> {
  const days = REPORT_RANGES[range];
  const scope = dailyScope(sql`l.id = ${linkId}`);
  const totalsOf = (where: ReturnType<typeof sql>) => sql`
    select coalesce(sum(clicks), 0)::int as clicks, coalesce(sum(visitors), 0)::int as visitors,
      coalesce(sum(ips), 0)::int as ips, coalesce(sum(bot_clicks), 0)::int as bot_clicks
    from link_days where ${where}`;
  // The days just before the period: from today - 2N + 1 to today - N.
  const before = days === null ? null : sql`day between today - ${2 * days - 1}::int and today - ${days}::int`;

  const trend =
    range === "today"
      ? sql`
          with ${scope}
          select lpad(h::text, 2, '0') as key, coalesce(count(c.*) filter (where not c.is_bot), 0)::int as clicks
          from lz
          cross join generate_series(0, extract(hour from now() at time zone lz.tz)::int) h
          left join clicks c on c.link_id = lz.link_id
            and c.clicked_at >= (lz.today::timestamp at time zone lz.tz)
            and extract(hour from c.clicked_at at time zone lz.tz)::int = h
          group by h order by h`
      : days === null
        ? sql`
            with ${scope},
            months as (
              select generate_series(
                date_trunc('month', coalesce((select min(day) from link_days), (select today from lz))),
                date_trunc('month', (select today from lz)),
                interval '1 month'
              )::date as month
            )
            select to_char(m.month, 'YYYY-MM') as key, coalesce(sum(d.clicks), 0)::int as clicks
            from months m left join link_days d on date_trunc('month', d.day)::date = m.month
            group by m.month order by m.month`
        : sql`
            with ${scope}
            select to_char(s.day, 'YYYY-MM-DD') as key, coalesce(sum(d.clicks), 0)::int as clicks
            from lz cross join generate_series(lz.today - ${days - 1}::int, lz.today, interval '1 day') s(day)
            left join link_days d on d.day = s.day::date
            group by s.day order by s.day`;

  const [[current], previous, trendRows, dims, [usage]] = await Promise.all([
    db().execute<{ clicks: number; visitors: number; ips: number; bot_clicks: number }>(
      sql`with ${scope} ${totalsOf(withinDays(days))}`,
    ),
    before
      ? db().execute<{ clicks: number; visitors: number; ips: number; bot_clicks: number }>(sql`with ${scope} ${totalsOf(before)}`)
      : Promise.resolve(null),
    db().execute<{ key: string; clicks: number }>(trend),
    db().execute<{ dim: string; value: string; clicks: number }>(sql`
      with ${scope}
      select dim, value, sum(clicks)::int as clicks from dim_days
      where dim in ('country', 'referrer') and ${withinDays(days)}
      group by dim, value`),
    db().execute<{ used: number; active: number }>(sql`
      with ${scope}
      select
        (select count(distinct placement_id)::int from placement_days
          where placement_id is not null and clicks > 0 and ${withinDays(days)}) as used,
        (select count(*)::int from placements where link_id = ${linkId} and is_active) as active`),
  ]);

  const toTotals = (row?: { clicks: number; visitors: number; ips: number; bot_clicks: number }): OverviewTotals => ({
    clicks: row?.clicks ?? 0,
    visitors: row?.visitors ?? 0,
    ips: row?.ips ?? 0,
    botClicks: row?.bot_clicks ?? 0,
  });
  // Ties in a stable order, so lists do not shuffle between loads.
  const top = (dim: string, limit: number) =>
    dims
      .filter((d) => d.dim === dim)
      .sort((a, b) => b.clicks - a.clicks || a.value.localeCompare(b.value))
      .slice(0, limit);

  return {
    totals: toTotals(current),
    previous: previous ? toTotals(previous[0]) : null,
    granularity: range === "today" ? "hour" : days === null ? "month" : "day",
    trend: [...trendRows],
    countries: top("country", TOP_PLACES).map((d) => ({ country: d.value || "Unknown", clicks: d.clicks })),
    referrers: top("referrer", TOP_REFERRERS).map((d) => ({ referrer: d.value || "Direct", clicks: d.clicks })),
    labelledUsed: usage?.used ?? 0,
    labelledActive: usage?.active ?? 0,
  };
}
