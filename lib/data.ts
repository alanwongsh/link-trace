import "server-only";

import { aliasedTable, and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { dailyScope } from "@/lib/daily-totals";
import { getDb } from "@/lib/db";
import { clicks, links, placements, users, workspaces } from "@/lib/db/schema";
import type { ClickDraft } from "@/lib/track";
import {
  schemaProblem,
  type Failure,
  type LinkDetail,
  type LinkKind,
  type LinkSummary,
  type RecentClick,
  type Result,
} from "@/lib/types";

// Drizzle wraps driver errors; the Postgres code and message live on the cause.
function pgError(error: unknown): { code?: string; message: string } {
  const source = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  if (source instanceof Error) {
    return { code: (source as { code?: string }).code, message: source.message };
  }
  return { message: "" };
}

function fail(error: unknown, fallback: string): Failure {
  const { message } = pgError(error);
  console.error(fallback, message);
  if (/password authentication failed|ECONNREFUSED|ENOTFOUND|getaddrinfo/i.test(message)) {
    return {
      ok: false,
      message: "Could not connect to the database. Check DATABASE_URL.",
      missingConfig: true,
    };
  }
  return {
    ok: false,
    message: message || fallback,
    missingSchema: schemaProblem(message),
  };
}

function unavailable(config: { message: string; missingConfig?: boolean }): Failure {
  return { ok: false, message: config.message, missingConfig: config.missingConfig };
}

// workspaceIds: the workspaces to include, or "all" for org admins.
export async function listLinks(filter: {
  workspaceIds: string[] | "all";
  createdBy?: string;
}): Promise<Result<LinkSummary[]>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);
  if (filter.workspaceIds !== "all" && filter.workspaceIds.length === 0) return { ok: true, data: [] };

  const where = linkScope(filter);

  // Counts come from the daily totals (all time); visitors and IPs are distinct per day, summed.
  try {
    const rows = await config.db.execute<LinkSummary>(sql`
      with ${dailyScope(where)},
      totals as (
        select link_id, sum(clicks)::int as clicks, sum(visitors)::int as visitors, sum(ips)::int as ips
        from link_days group by link_id
      )
      select l.id, l.slug, l.kind, l.url, l.title, coalesce(l.tags, '{}') as tags,
        to_json(l.created_at) #>> '{}' as created_at,
        coalesce(t.clicks, 0) as click_count, coalesce(t.visitors, 0) as visitor_count, coalesce(t.ips, 0) as ip_count,
        l.workspace_id, w.name as workspace_name, l.created_by, u.name as created_by_name
      from links l
      join workspaces w on w.id = l.workspace_id
      left join users u on u.id = l.created_by
      left join totals t on t.link_id = l.id
      where ${where}
      order by l.created_at desc`);
    return {
      ok: true,
      data: rows.map((link) => ({ ...link, kind: link.kind === "page" ? "page" : "redirect", tags: link.tags ?? [] })),
    };
  } catch (error) {
    return fail(error, "Could not load links.");
  }
}

export async function insertLink(input: {
  slug: string;
  kind: LinkKind;
  url: string | null;
  html: string | null;
  title: string | null;
  tags: string[];
  workspaceId: string;
  createdBy: string;
}): Promise<Result<{ slug: string; id: string }>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    const [row] = await config.db.insert(links).values(input).returning({ id: links.id });
    return { ok: true, data: { slug: input.slug, id: row.id } };
  } catch (error) {
    if (pgError(error).code === "23505") {
      return { ok: false, message: "That slug is already in use." };
    }
    return fail(error, "Could not create the link.");
  }
}

export async function deleteLink(slug: string): Promise<Result<null>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    await config.db.delete(links).where(eq(links.slug, slug));
    return { ok: true, data: null };
  } catch (error) {
    return fail(error, "Could not delete the link.");
  }
}

// Returns false when no link has this slug.
export async function saveTarget(
  slug: string,
  target: { kind: LinkKind; url: string | null; html: string | null },
  updatedBy: string,
): Promise<Result<boolean>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    const updated = await config.db
      .update(links)
      .set({
        kind: target.kind,
        url: target.url,
        html: target.html,
        updatedBy,
        updatedAt: sql`now()`,
      })
      .where(eq(links.slug, slug))
      .returning({ id: links.id });
    return { ok: true, data: updated.length > 0 };
  } catch (error) {
    return fail(error, "Could not save the destination.");
  }
}

export type Destination = {
  id: string;
  workspaceId: string;
  kind: LinkKind;
  url: string | null;
  html: string | null;
  tags: string[];
};

export async function findDestination(slug: string): Promise<Result<Destination | null>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    const [row] = await config.db
      .select({
        id: links.id,
        workspaceId: links.workspaceId,
        kind: links.kind,
        url: links.url,
        html: links.html,
        tags: links.tags,
      })
      .from(links)
      .where(eq(links.slug, slug))
      .limit(1);
    if (!row) return { ok: true, data: null };
    return { ok: true, data: { ...row, tags: row.tags ?? [] } };
  } catch (error) {
    return fail(error, "Could not load the link.");
  }
}

export async function saveTags(slug: string, tags: string[], updatedBy: string): Promise<Result<null>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    await config.db
      .update(links)
      .set({ tags, updatedBy, updatedAt: sql`now()` })
      .where(eq(links.slug, slug));
    return { ok: true, data: null };
  } catch (error) {
    return fail(error, "Could not save tags.");
  }
}

export async function moveLink(slug: string, workspaceId: string, updatedBy: string): Promise<Result<null>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    await config.db
      .update(links)
      .set({ workspaceId, updatedBy, updatedAt: sql`now()` })
      .where(eq(links.slug, slug));
    return { ok: true, data: null };
  } catch (error) {
    return fail(error, "Could not move the link.");
  }
}

const creator = aliasedTable(users, "creator");
const editor = aliasedTable(users, "editor");

// Who owns and last changed a link, for the stats page.
export async function linkOwnership(slug: string): Promise<{
  workspaceId: string;
  workspaceName: string;
  createdByName: string | null;
  updatedByName: string | null;
  updatedAt: string | null;
} | null> {
  const config = getDb();
  if (!config.ok) return null;
  const [row] = await config.db
    .select({
      workspaceId: links.workspaceId,
      workspaceName: workspaces.name,
      createdByName: creator.name,
      updatedByName: editor.name,
      updatedAt: links.updatedAt,
    })
    .from(links)
    .innerJoin(workspaces, eq(workspaces.id, links.workspaceId))
    .leftJoin(creator, eq(creator.id, links.createdBy))
    .leftJoin(editor, eq(editor.id, links.updatedBy))
    .where(eq(links.slug, slug))
    .limit(1);
  return row ?? null;
}

// placementId: set for /q/<code> visits. For a tag visit with no placement given, the
// placement made from that tag (if any) is looked up in the same insert.
export async function insertClick(
  linkId: string,
  click: ClickDraft,
  tag: string | null,
  placementId: string | null = null,
): Promise<void> {
  const config = getDb();
  if (!config.ok) return;

  try {
    await config.db.insert(clicks).values({
      linkId,
      visitorId: click.visitorId,
      ip: click.ip,
      userAgent: click.userAgent,
      referrer: click.referrer,
      country: click.country,
      region: click.region,
      city: click.city,
      isBot: click.isBot,
      tag,
      placementId:
        placementId ??
        (tag
          ? sql`(select ${placements.id} from ${placements} where ${placements.linkId} = ${linkId} and ${placements.legacyTag} = ${tag})`
          : null),
    });
  } catch (error) {
    console.error("Failed to record click:", pgError(error).message);
  }
}

// Days shown on a link's daily chart.
const DETAIL_DAYS = 14;
// Rows kept from each breakdown, and recent clicks listed.
const DETAIL_COUNTRIES = 50;
const DETAIL_REFERRERS = 8;
const DETAIL_RECENT = 50;

type TotalsRow = { clicks: number; visitors: number; ips: number; bot_clicks: number; today: number; week: number };

// A link's overview, from the daily totals (see lib/daily-totals.ts) in its workspace timezone.
// Only the recent clicks list reads clicks directly: the newest 50 rows through an index.
export async function loadDetail(slug: string): Promise<Result<LinkDetail | null>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    const [link] = await config.db.execute<LinkDetail["link"] & { timezone: string }>(sql`
      select l.id, l.slug, l.kind, l.url, l.title, coalesce(l.tags, '{}') as tags,
        to_json(l.created_at) #>> '{}' as created_at, w.timezone
      from links l join workspaces w on w.id = l.workspace_id where l.slug = ${slug}`);
    if (!link) return { ok: true, data: null };

    const scope = dailyScope(sql`l.id = ${link.id}`);
    const [[totals], daily, dims, recent] = await Promise.all([
      config.db.execute<TotalsRow>(sql`with ${scope} ${totalsSelect}`),
      config.db.execute<{ day: string; clicks: number }>(sql`
        with ${scope}
        select to_char(s.day, 'YYYY-MM-DD') as day, coalesce(sum(d.clicks), 0)::int as clicks
        from lz cross join generate_series(lz.today - ${DETAIL_DAYS - 1}::int, lz.today, interval '1 day') s(day)
        left join link_days d on d.day = s.day::date
        group by s.day order by s.day`),
      config.db.execute<{ dim: string; value: string; clicks: number; visitors: number }>(sql`
        with ${scope}
        select dim, value, sum(clicks)::int as clicks, sum(visitors)::int as visitors from dim_days group by dim, value`),
      config.db.execute<RecentClick>(sql`
        select visitor_id, ip, user_agent, referrer, country, region, city, is_bot, tag,
          to_json(clicked_at) #>> '{}' as clicked_at
        from clicks where link_id = ${link.id} order by clicked_at desc limit ${DETAIL_RECENT}`),
    ]);

    const of = (dim: string) => dims.filter((d) => d.dim === dim);
    const byTag = new Map(of("tag").map((d) => [d.value, d]));
    const tags = Array.isArray(link.tags) ? link.tags : [];
    // Ties in a stable order, so the list does not shuffle between loads.
    const top = <T extends { value: string; clicks: number }>(rows: T[], limit: number) =>
      [...rows].sort((a, b) => b.clicks - a.clicks || a.value.localeCompare(b.value)).slice(0, limit);

    return {
      ok: true,
      data: {
        link: {
          id: link.id,
          slug: link.slug,
          kind: link.kind === "page" ? "page" : "redirect",
          url: link.url,
          title: link.title,
          tags,
          created_at: link.created_at,
        },
        untagged_clicks: byTag.get("")?.clicks ?? 0,
        untagged_visitors: byTag.get("")?.visitors ?? 0,
        tag_stats: tags
          .map((tag) => ({ tag, clicks: byTag.get(tag)?.clicks ?? 0, visitors: byTag.get(tag)?.visitors ?? 0 }))
          .sort((a, b) => b.clicks - a.clicks || a.tag.localeCompare(b.tag)),
        total_clicks: totals?.clicks ?? 0,
        unique_visitors: totals?.visitors ?? 0,
        unique_ips: totals?.ips ?? 0,
        clicks_today: totals?.today ?? 0,
        clicks_7d: totals?.week ?? 0,
        bot_clicks: totals?.bot_clicks ?? 0,
        daily: [...daily],
        countries: top(of("country"), DETAIL_COUNTRIES).map((d) => ({
          country: d.value || "Unknown",
          clicks: d.clicks,
        })),
        referrers: top(of("referrer"), DETAIL_REFERRERS).map((d) => ({
          referrer: d.value || "Direct",
          clicks: d.clicks,
        })),
        recent: recent.map((click) => ({ ...click, tag: click.tag ?? null })),
        timezone: link.timezone,
      },
    };
  } catch (error) {
    return fail(error, "Could not load stats.");
  }
}

// Totals over link_days: all time, plus today and the last 7 days in each link's own zone.
const totalsSelect = sql`
  select coalesce(sum(clicks), 0)::int as clicks, coalesce(sum(visitors), 0)::int as visitors,
    coalesce(sum(ips), 0)::int as ips, coalesce(sum(bot_clicks), 0)::int as bot_clicks,
    coalesce(sum(clicks) filter (where day = today), 0)::int as today,
    coalesce(sum(clicks) filter (where day >= today - 6), 0)::int as week
  from link_days`;

// The links a dashboard or list covers, as a condition on l and w for dailyScope.
function linkScope(filter: { workspaceIds: string[] | "all"; createdBy?: string }): SQL {
  const conditions: SQL[] = [];
  if (filter.workspaceIds !== "all") {
    conditions.push(sql`l.workspace_id in (${sql.join(filter.workspaceIds.map((id) => sql`${id}`), sql`, `)})`);
  }
  if (filter.createdBy) conditions.push(sql`l.created_by = ${filter.createdBy}`);
  return conditions.length ? sql.join(conditions, sql` and `) : sql`true`;
}

export type DashboardSummary = {
  clicks: number;
  visitors: number;
  clicks7d: number;
  clicksToday: number;
  botClicks: number;
  daily: { day: string; clicks: number }[];
  tags: { tag: string; clicks: number }[];
  countries: { country: string; clicks: number }[];
  // The workspace timezones the covered links count their days in.
  timezones: string[];
};

// Totals across every link the filter covers, from the daily totals. Bots are left out of
// everything except botClicks. Each link counts its days (today, 7 days, the chart) in its own
// workspace's timezone; the chart runs up to the latest of those todays.
export async function loadDashboard(filter: {
  workspaceIds: string[] | "all";
  createdBy?: string;
  days?: number;
}): Promise<Result<DashboardSummary>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);
  const days = filter.days ?? 30;
  const empty: DashboardSummary = {
    clicks: 0, visitors: 0, clicks7d: 0, clicksToday: 0, botClicks: 0, daily: [], tags: [], countries: [], timezones: [],
  };
  if (filter.workspaceIds !== "all" && filter.workspaceIds.length === 0) return { ok: true, data: empty };
  const scope = dailyScope(linkScope(filter));

  try {
    const [[totals], daily, dims, zones] = await Promise.all([
      config.db.execute<TotalsRow>(sql`with ${scope} ${totalsSelect}`),
      config.db.execute<{ day: string; clicks: number }>(sql`
        with ${scope}, last as (select coalesce(max(today), (now() at time zone 'utc')::date) as day from lz)
        select to_char(s.day, 'YYYY-MM-DD') as day, coalesce(sum(d.clicks), 0)::int as clicks
        from last cross join generate_series(last.day - ${days - 1}::int, last.day, interval '1 day') s(day)
        left join link_days d on d.day = s.day::date
        group by s.day order by s.day`),
      config.db.execute<{ dim: string; value: string; clicks: number }>(sql`
        with ${scope}
        select dim, value, sum(clicks)::int as clicks from dim_days where dim in ('tag', 'country')
        group by dim, value`),
      config.db.execute<{ tz: string }>(sql`with ${scope} select distinct tz from lz order by tz`),
    ]);
    const topEight = (dim: string, empty: string) =>
      dims
        .filter((d) => d.dim === dim)
        .sort((a, b) => b.clicks - a.clicks || a.value.localeCompare(b.value))
        .slice(0, 8)
        .map((d) => ({ value: d.value || empty, clicks: d.clicks }));
    return {
      ok: true,
      data: {
        clicks: totals?.clicks ?? 0,
        visitors: totals?.visitors ?? 0,
        clicks7d: totals?.week ?? 0,
        clicksToday: totals?.today ?? 0,
        botClicks: totals?.bot_clicks ?? 0,
        daily: [...daily],
        tags: topEight("tag", "").map((d) => ({ tag: d.value, clicks: d.clicks })),
        countries: topEight("country", "Unknown").map((d) => ({ country: d.value, clicks: d.clicks })),
        timezones: zones.map((z) => z.tz),
      },
    };
  } catch (error) {
    return fail(error, "Could not load the dashboard.");
  }
}
