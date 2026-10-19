import "server-only";

import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";

function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

export const REPORT_RANGES = { "7d": 7, "30d": 30, "90d": 90, all: null } as const;
export type ReportRange = keyof typeof REPORT_RANGES;
// Labels a report can be grouped by at once.
export const MAX_GROUP_BY = 3;
// Rows a report returns; the rest are left out and counted.
export const REPORT_ROW_LIMIT = 1000;

export type ReportParameter = { id: string; key: string; name: string };

// The labels this link's labelled links use, in the workspace's order: the ones worth grouping by.
export async function reportParameters(linkId: string): Promise<ReportParameter[]> {
  const rows = await db().execute<ReportParameter>(sql`
    select t.id, t.key, t.name from tracking_parameters t
    where t.id in (
      select v.parameter_id from placement_values v join placements p on p.id = v.placement_id where p.link_id = ${linkId}
    )
    order by t.sort_order, t.created_at`);
  return [...rows];
}

// Reads ?by=key1,key2&range=30d. Unknown keys are dropped, and so are repeats past MAX_GROUP_BY.
// With no by=, the report groups by fallback (normally the first label the link's labelled links use).
export function readReportQuery(
  raw: { by?: string; range?: string },
  parameters: ReportParameter[],
  fallback: ReportParameter[],
): { groupBy: ReportParameter[]; range: ReportRange; explicit: boolean } {
  const range = (Object.keys(REPORT_RANGES) as ReportRange[]).find((r) => r === raw.range) ?? "30d";
  if (raw.by === undefined) return { groupBy: fallback.slice(0, MAX_GROUP_BY), range, explicit: false };
  const byKey = new Map(parameters.map((p) => [p.key, p]));
  const keys = [...new Set(raw.by.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean))];
  const groupBy = keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])).slice(0, MAX_GROUP_BY);
  return { groupBy, range, explicit: true };
}

export type ReportCell = { value: string; label: string | null } | null;
export type ReportRow = {
  // One cell per grouped label, in the order asked; null when the visit's labelled link has no value.
  cells: ReportCell[];
  // True for visits that came through the main link (or an older tag link), not a labelled link.
  direct: boolean;
  clicks: number;
  visitors: number;
};

export type LinkReport = {
  rows: ReportRow[];
  // Every human visit in the range, so shares add up even when rows are cut off.
  totalClicks: number;
  totalVisitors: number;
  truncated: boolean;
};

// Human visits to one link in the range, grouped by the given parameters (ids, in order). Each
// visit takes the values of the labelled link it came through; inactive parameters still report.
export async function linkReport(
  linkId: string,
  parameterIds: string[],
  range: ReportRange,
  limit = REPORT_ROW_LIMIT,
): Promise<LinkReport> {
  const days = REPORT_RANGES[range];
  const since = days === null ? sql`true` : sql`c.clicked_at >= now() - make_interval(days => ${days})`;
  const joins = parameterIds.map(
    (id, i) => sql`
      left join placement_values ${sql.raw(`v${i}`)} on ${sql.raw(`v${i}`)}.placement_id = c.placement_id
        and ${sql.raw(`v${i}`)}.parameter_id = ${id}
      left join tracking_parameter_options ${sql.raw(`o${i}`)} on ${sql.raw(`o${i}`)}.id = ${sql.raw(`v${i}`)}.option_id`,
  );
  const columns = parameterIds.flatMap((_, i) => [
    sql`${sql.raw(`v${i}`)}.value as ${sql.raw(`value${i}`)}`,
    sql`${sql.raw(`o${i}`)}.label as ${sql.raw(`label${i}`)}`,
  ]);
  const groups = parameterIds.flatMap((_, i) => [sql.raw(`v${i}.value`), sql.raw(`o${i}.label`)]);

  const [rows, [totals]] = await Promise.all([
    db().execute<Record<string, string | number | boolean | null>>(sql`
      select ${sql.join([...columns, sql`c.placement_id is null as direct`], sql`, `)},
        count(*)::int as clicks, count(distinct c.visitor_id)::int as visitors
      from clicks c ${sql.join(joins, sql` `)}
      where c.link_id = ${linkId} and not c.is_bot and ${since}
      group by ${sql.join([...groups, sql`c.placement_id is null`], sql`, `)}
      order by clicks desc, visitors desc
      limit ${limit + 1}`),
    db().execute<{ clicks: number; visitors: number }>(sql`
      select count(*)::int as clicks, count(distinct c.visitor_id)::int as visitors
      from clicks c where c.link_id = ${linkId} and not c.is_bot and ${since}`),
  ]);

  return {
    rows: [...rows].slice(0, limit).map((row) => ({
      cells: parameterIds.map((_, i) =>
        row[`value${i}`] === null ? null : { value: String(row[`value${i}`]), label: (row[`label${i}`] as string | null) ?? null },
      ),
      direct: Boolean(row.direct),
      clicks: Number(row.clicks),
      visitors: Number(row.visitors),
    })),
    totalClicks: totals?.clicks ?? 0,
    totalVisitors: totals?.visitors ?? 0,
    truncated: rows.length > limit,
  };
}
