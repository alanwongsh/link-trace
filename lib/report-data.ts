import "server-only";

import { sql } from "drizzle-orm";
import { after } from "next/server";
import { dailyScope, withinDays } from "@/lib/daily-totals";
import { getDb, type Db } from "@/lib/db";
import { enqueue, jobsRunInline } from "@/lib/queue";

function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

export { REPORT_RANGES, type ReportRange } from "@/lib/report-periods";
import { REPORT_RANGES, type ReportRange } from "@/lib/report-periods";
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

// A filter on one label: visits whose labelled link has any of these values (case ignored).
export type ReportFilter = { parameter: ReportParameter; values: string[] };
// Filter values in the address are named f_<label key>, one per value: ?f_store=KL001&f_store=PG002.
export const FILTER_PREFIX = "f_";
// Values one filter can hold.
const MAX_FILTER_VALUES = 500;

// The f_<key> values from an address's query, by label key.
export function filterValues(entries: Iterable<[string, string | string[] | undefined]>): Record<string, string[]> {
  const found: Record<string, string[]> = {};
  for (const [name, raw] of entries) {
    if (!name.startsWith(FILTER_PREFIX) || raw === undefined) continue;
    const key = name.slice(FILTER_PREFIX.length).toLowerCase();
    (found[key] ??= []).push(...(Array.isArray(raw) ? raw : [raw]));
  }
  return found;
}

// Reads ?by=key1,key2&range=30d&f_key=value…. Unknown keys are dropped, and so are group-by labels
// past MAX_GROUP_BY. With no by=, the report groups by fallback (normally the first label the
// link's labelled links use). Several values of one filter mean any of them; several filters, all.
export function readReportQuery(
  raw: { by?: string; range?: string; filters?: Record<string, string[]> },
  parameters: ReportParameter[],
  fallback: ReportParameter[],
): { groupBy: ReportParameter[]; range: ReportRange; filters: ReportFilter[]; explicit: boolean } {
  const range = (Object.keys(REPORT_RANGES) as ReportRange[]).find((r) => r === raw.range) ?? "30d";
  const byKey = new Map(parameters.map((p) => [p.key, p]));
  // In label order, so the filter bar and the address agree.
  const filters = parameters.flatMap((parameter) => {
    const values = [...new Set((raw.filters?.[parameter.key] ?? []).map((v) => v.trim()).filter(Boolean))].slice(
      0,
      MAX_FILTER_VALUES,
    );
    return values.length ? [{ parameter, values }] : [];
  });
  if (raw.by === undefined) return { groupBy: fallback.slice(0, MAX_GROUP_BY), range, filters, explicit: false };
  const keys = [...new Set(raw.by.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean))];
  const groupBy = keys.flatMap((k) => (byKey.has(k) ? [byKey.get(k)!] : [])).slice(0, MAX_GROUP_BY);
  return { groupBy, range, filters, explicit: true };
}

// The values each label has on this link's labelled links, with option labels, for the filter bar.
export async function reportFilterOptions(linkId: string): Promise<Map<string, { value: string; label: string | null }[]>> {
  const rows = await db().execute<{ parameter_id: string; value: string; label: string | null }>(sql`
    select distinct v.parameter_id, v.value, o.label
    from placement_values v
    join placements p on p.id = v.placement_id
    left join tracking_parameter_options o on o.id = v.option_id
    where p.link_id = ${linkId}
    order by v.value`);
  const byParameter = new Map<string, { value: string; label: string | null }[]>();
  for (const row of rows) {
    const list = byParameter.get(row.parameter_id) ?? [];
    if (!list.some((v) => v.value.toLowerCase() === row.value.toLowerCase())) list.push({ value: row.value, label: row.label });
    byParameter.set(row.parameter_id, list);
  }
  return byParameter;
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

// The inline queue has no schedule, so a page that finds a timezone's yesterday not yet totalled
// starts the rollup after it responds. Pages are right either way; this only keeps them fast. A
// worker runs click-rollup hourly by itself.
export async function keepRollupCurrent(): Promise<void> {
  if (!jobsRunInline()) return;
  const [row] = await db().execute<{ behind: boolean }>(sql`
    select exists (
      select 1 from (select distinct timezone from workspaces) z
      left join rollup_progress p on p.name = 'daily:' || z.timezone
      where coalesce(p.through, date '1970-01-01') < (now() at time zone z.timezone)::date - 1
    ) as behind`);
  if (!row?.behind) return;
  after(() => enqueue("click-rollup", {}).catch((error) => console.error("click-rollup failed:", error)));
}

// Human clicks and daily visitors per labelled link (placement_id null for the main link) for the
// last `days` local days including today, or all time. See dailyScope for where they come from.
export function perPlacementTotals(linkId: string, days: number | null) {
  return sql`
    with ${dailyScope(sql`l.id = ${linkId}`)}
    select placement_id, sum(clicks)::int as clicks, sum(visitors)::int as visitors
    from placement_days where ${withinDays(days)}
    group by placement_id`;
}

// Human visits to one link in the range, grouped by the given parameters (ids, in order). Each
// visit takes the values of the labelled link it came through; inactive parameters still report.
// Visitors are distinct per day and summed, so a visitor coming back on another day counts again.
export async function linkReport(
  linkId: string,
  parameterIds: string[],
  range: ReportRange,
  options: { limit?: number; filters?: { parameterId: string; values: string[] }[] } = {},
): Promise<LinkReport> {
  const limit = options.limit ?? REPORT_ROW_LIMIT;
  const totalsByPlacement = perPlacementTotals(linkId, REPORT_RANGES[range]);
  // Each filter keeps labelled links with any of its values; together they must all match. The
  // main link has no labels, so it drops out once any filter is set.
  const filters = (options.filters ?? []).filter((f) => f.values.length > 0);
  const matches = filters.map(
    (f) => sql`exists (
      select 1 from placement_values fv
      where fv.placement_id = p.placement_id and fv.parameter_id = ${f.parameterId}
        and lower(fv.value) in (${sql.join(f.values.map((v) => sql`${v.toLowerCase()}`), sql`, `)}))`,
  );
  const joins = parameterIds.map(
    (id, i) => sql`
      left join placement_values ${sql.raw(`v${i}`)} on ${sql.raw(`v${i}`)}.placement_id = p.placement_id
        and ${sql.raw(`v${i}`)}.parameter_id = ${id}
      left join tracking_parameter_options ${sql.raw(`o${i}`)} on ${sql.raw(`o${i}`)}.id = ${sql.raw(`v${i}`)}.option_id`,
  );
  const columns = parameterIds.flatMap((_, i) => [
    sql`${sql.raw(`v${i}`)}.value as ${sql.raw(`value${i}`)}`,
    sql`${sql.raw(`o${i}`)}.label as ${sql.raw(`label${i}`)}`,
  ]);
  const groups = parameterIds.flatMap((_, i) => [sql.raw(`v${i}.value`), sql.raw(`o${i}.label`)]);

  // One query: the per-labelled-link totals are small (one row per labelled link), then grouped.
  const rows = await db().execute<Record<string, string | number | boolean | null>>(sql`
    with p as (${totalsByPlacement})
    select ${sql.join([...columns, sql`p.placement_id is null as direct`], sql`, `)},
      sum(p.clicks)::int as clicks, sum(p.visitors)::int as visitors,
      (sum(sum(p.clicks)) over ())::int as total_clicks, (sum(sum(p.visitors)) over ())::int as total_visitors
    from p ${sql.join(joins, sql` `)}
    where ${sql.join([sql`p.clicks > 0`, ...matches], sql` and `)}
    group by ${sql.join([...groups, sql`p.placement_id is null`], sql`, `)}
    order by clicks desc, visitors desc
    limit ${limit + 1}`);
  const totals = { clicks: Number(rows[0]?.total_clicks ?? 0), visitors: Number(rows[0]?.total_visitors ?? 0) };

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
