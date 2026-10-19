import "server-only";

import { aliasedTable, and, desc, eq, getViewSelectedFields, inArray, sql, type SQL } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clicks, linkSummaries, links, placements, users, workspaces } from "@/lib/db/schema";
import type { ClickDraft } from "@/lib/track";
import {
  schemaProblem,
  type Failure,
  type LinkDetail,
  type LinkKind,
  type LinkSummary,
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

  const conditions: SQL[] = [];
  if (filter.workspaceIds !== "all") {
    conditions.push(inArray(linkSummaries.workspace_id, filter.workspaceIds));
  }
  if (filter.createdBy) conditions.push(eq(linkSummaries.created_by, filter.createdBy));

  try {
    const rows = await config.db
      .select({
        ...getViewSelectedFields(linkSummaries),
        workspace_name: workspaces.name,
        created_by_name: users.name,
      })
      .from(linkSummaries)
      .innerJoin(workspaces, eq(workspaces.id, linkSummaries.workspace_id))
      .leftJoin(users, eq(users.id, linkSummaries.created_by))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(linkSummaries.created_at));
    return {
      ok: true,
      data: rows.map((link) => ({ ...link, tags: link.tags ?? [] })),
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

export async function loadDetail(slug: string): Promise<Result<LinkDetail | null>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    const rows = await config.db.execute<{ detail: LinkDetail | string | null }>(
      sql`select link_detail(${slug}) as detail`,
    );
    const data = rows[0]?.detail;
    if (!data) return { ok: true, data: null };
    const parsed = typeof data === "string" ? (JSON.parse(data) as LinkDetail) : data;
    return { ok: true, data: normalizeDetail(parsed) };
  } catch (error) {
    return fail(error, "Could not load stats.");
  }
}

function normalizeDetail(detail: LinkDetail): LinkDetail {
  return {
    ...detail,
    link: {
      ...detail.link,
      kind: detail.link?.kind === "page" ? "page" : "redirect",
      tags: Array.isArray(detail.link?.tags) ? detail.link.tags : [],
    },
    tag_stats: Array.isArray(detail.tag_stats) ? detail.tag_stats : [],
    untagged_clicks: detail.untagged_clicks ?? 0,
    untagged_visitors: detail.untagged_visitors ?? 0,
    recent: (detail.recent ?? []).map((click) => ({
      ...click,
      tag: click.tag ?? null,
    })),
  };
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
};

// Totals across every link the filter covers. Same rules as link_detail(): bots are left out
// of everything except botClicks, and days are grouped in UTC.
export async function loadDashboard(filter: {
  workspaceIds: string[] | "all";
  createdBy?: string;
  days?: number;
}): Promise<Result<DashboardSummary>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);
  const days = filter.days ?? 30;
  const empty: DashboardSummary = {
    clicks: 0, visitors: 0, clicks7d: 0, clicksToday: 0, botClicks: 0, daily: [], tags: [], countries: [],
  };
  if (filter.workspaceIds !== "all" && filter.workspaceIds.length === 0) return { ok: true, data: empty };

  const conditions: SQL[] = [];
  if (filter.workspaceIds !== "all") conditions.push(inArray(links.workspaceId, filter.workspaceIds));
  if (filter.createdBy) conditions.push(eq(links.createdBy, filter.createdBy));
  const where = conditions.length ? sql`where ${and(...conditions)}` : sql``;
  const scoped = sql`select ${clicks.id} as id, ${clicks.visitorId} as visitor_id, ${clicks.tag} as tag,
    ${clicks.country} as country, ${clicks.isBot} as is_bot, ${clicks.clickedAt} as clicked_at
    from ${clicks} inner join ${links} on ${links.id} = ${clicks.linkId} ${where}`;

  try {
    const [totals, daily, tags, countries] = await Promise.all([
      config.db.execute<{ clicks: number; visitors: number; clicks_7d: number; clicks_today: number; bot_clicks: number }>(sql`
        with s as (${scoped})
        select
          count(*) filter (where not is_bot)::int as clicks,
          count(distinct visitor_id) filter (where not is_bot)::int as visitors,
          count(*) filter (where not is_bot and clicked_at >= now() - interval '7 days')::int as clicks_7d,
          count(*) filter (where not is_bot and (clicked_at at time zone 'utc') >= date_trunc('day', now() at time zone 'utc'))::int as clicks_today,
          count(*) filter (where is_bot)::int as bot_clicks
        from s`),
      config.db.execute<{ day: string; clicks: number }>(sql`
        with s as (${scoped}), h as (select clicked_at from s where not is_bot
          and clicked_at >= (date_trunc('day', now() at time zone 'utc') - make_interval(days => ${days - 1})) at time zone 'utc')
        select to_char(series.day, 'YYYY-MM-DD') as day, count(h.clicked_at)::int as clicks
        from generate_series(
          date_trunc('day', now() at time zone 'utc') - make_interval(days => ${days - 1}),
          date_trunc('day', now() at time zone 'utc'),
          interval '1 day'
        ) as series(day)
        left join h on (h.clicked_at at time zone 'utc') >= series.day
          and (h.clicked_at at time zone 'utc') < series.day + interval '1 day'
        group by series.day order by series.day`),
      config.db.execute<{ tag: string; clicks: number }>(sql`
        with s as (${scoped})
        select coalesce(tag, '') as tag, count(*)::int as clicks from s where not is_bot
        group by 1 order by 2 desc, 1 limit 8`),
      config.db.execute<{ country: string; clicks: number }>(sql`
        with s as (${scoped})
        select coalesce(country, 'Unknown') as country, count(*)::int as clicks from s where not is_bot
        group by 1 order by 2 desc, 1 limit 8`),
    ]);
    const t = totals[0];
    return {
      ok: true,
      data: {
        clicks: t?.clicks ?? 0,
        visitors: t?.visitors ?? 0,
        clicks7d: t?.clicks_7d ?? 0,
        clicksToday: t?.clicks_today ?? 0,
        botClicks: t?.bot_clicks ?? 0,
        daily: [...daily],
        tags: [...tags],
        countries: [...countries],
      },
    };
  } catch (error) {
    return fail(error, "Could not load the dashboard.");
  }
}
