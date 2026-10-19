// Keeps the daily totals current (click_daily, click_daily_link, click_daily_dim), so pages read
// days instead of every click. A day is a local date in the link's workspace timezone, so each
// zone is rolled up on its own, with its progress in rollup_progress as "daily:<zone>". Run by the
// click-rollup job (hourly with a worker, on demand with the inline queue). Plain SQL with
// relative imports only, like lib/bulk-job.ts.
import type { PendingQuery, Row, Sql, TransactionSql } from "postgres";

export const progressName = (zone: string) => `daily:${zone}`;
// Finished days redone on every run, so clicks saved late (queued around midnight) still count.
export const REDO_DAYS = 2;

type Tx = TransactionSql<Record<string, unknown>>;

// Writes all three tables for the links that match `links` (a filter on l, joined to its
// workspace w), for local days from..through in `zone`, replacing what was there.
async function writeDays(tx: Tx, zone: string, from: string, through: string, links: PendingQuery<Row[]>) {
  const source = tx`from clicks c join links l on l.id = c.link_id join workspaces w on w.id = l.workspace_id`;
  const where = tx`
    where w.timezone = ${zone} and ${links}
      and c.clicked_at >= (${from}::date::timestamp at time zone ${zone})
      and c.clicked_at < ((${through}::date + 1)::timestamp at time zone ${zone})`;
  const scope = tx`${source} ${where}`;
  const day = tx`(c.clicked_at at time zone ${zone})::date`;
  const inScope = tx`link_id in (select l.id from links l join workspaces w on w.id = l.workspace_id where w.timezone = ${zone} and ${links})
    and day between ${from}::date and ${through}::date`;

  await tx`delete from click_daily where ${inScope}`;
  await tx`delete from click_daily_link where ${inScope}`;
  await tx`delete from click_daily_dim where ${inScope}`;
  await tx`
    insert into click_daily (link_id, placement_id, day, clicks, visitors)
    select c.link_id, c.placement_id, ${day}, count(*)::int, count(distinct c.visitor_id)::int
    ${scope} and not c.is_bot
    group by 1, 2, 3`;
  await tx`
    insert into click_daily_link (link_id, day, clicks, visitors, ips, bot_clicks)
    select c.link_id, ${day},
      count(*) filter (where not c.is_bot)::int,
      count(distinct c.visitor_id) filter (where not c.is_bot)::int,
      count(distinct c.ip) filter (where not c.is_bot)::int,
      count(*) filter (where c.is_bot)::int
    ${scope}
    group by 1, 2`;
  await tx`
    insert into click_daily_dim (link_id, day, dim, value, clicks, visitors)
    select c.link_id, ${day}, d.dim, d.value, count(*)::int, count(distinct c.visitor_id)::int
    ${source}
    cross join lateral (values ('tag', coalesce(c.tag, '')), ('country', coalesce(c.country, '')), ('referrer', coalesce(c.referrer, ''))) d(dim, value)
    ${where} and not c.is_bot
    group by 1, 2, 3, 4`;
}

// Rolls up every finished local day not yet totalled in each workspace timezone, plus the last
// REDO_DAYS again. Safe to run at the same time from several places: one waits for the other, then
// has little left to do. Returns the zone-days written.
export async function rollUpClicks(sql: Sql): Promise<number> {
  const zones = await sql<{ zone: string }[]>`select distinct timezone as zone from workspaces order by 1`;
  let written = 0;
  for (const { zone } of zones) {
    written += await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${progressName(zone)}))`;
      const [state] = await tx<{ start: string | null; end: string }[]>`
        select
          coalesce(
            (select through - ${REDO_DAYS - 1}::int from rollup_progress where name = ${progressName(zone)}),
            (select (min(c.clicked_at) at time zone ${zone})::date from clicks c
              join links l on l.id = c.link_id join workspaces w on w.id = l.workspace_id where w.timezone = ${zone})
          )::text as start,
          ((now() at time zone ${zone})::date - 1)::text as end`;
      if (state.start && state.start <= state.end) await writeDays(tx, zone, state.start, state.end, tx`true`);
      await tx`
        insert into rollup_progress (name, through) values (${progressName(zone)}, ${state.end}::date)
        on conflict (name) do update set through = excluded.through, updated_at = now()`;
      if (!state.start || state.start > state.end) return 0;
      const [{ days }] = await tx<{ days: number }[]>`select (${state.end}::date - ${state.start}::date + 1)::int as days`;
      return days;
    });
  }
  return written;
}

// Rebuilds the totals of some links in full, in their workspace's current timezone: after a
// workspace changes timezone or a link moves workspace. Rows left in other zones' days are removed.
export async function rebuildTotals(sql: Sql, target: { workspaceId: string } | { linkIds: string[] }): Promise<void> {
  const linkIds =
    "workspaceId" in target
      ? (await sql<{ id: string }[]>`select id from links where workspace_id = ${target.workspaceId}`).map((r) => r.id)
      : target.linkIds;
  if (linkIds.length === 0) return;
  const zones = await sql<{ zone: string }[]>`
    select distinct w.timezone as zone from links l join workspaces w on w.id = l.workspace_id where l.id in ${sql(linkIds)}`;
  for (const { zone } of zones) {
    await sql.begin(async (tx) => {
      await tx`select pg_advisory_xact_lock(hashtext(${progressName(zone)}))`;
      const ids = tx`l.id in ${tx(linkIds)}`;
      // Every day these links have, old zone or new.
      for (const table of ["click_daily", "click_daily_link", "click_daily_dim"] as const) {
        await tx`delete from ${tx(table)} where link_id in ${tx(linkIds)}`;
      }
      const [state] = await tx<{ start: string | null; end: string | null }[]>`
        select
          (select (min(c.clicked_at) at time zone ${zone})::date from clicks c join links l on l.id = c.link_id where ${ids})::text as start,
          (select through from rollup_progress where name = ${progressName(zone)})::text as end`;
      // With no progress yet for the zone, the next rollup totals these links with the rest of it.
      if (state.start && state.end && state.start <= state.end) await writeDays(tx, zone, state.start, state.end, ids);
    });
  }
}
