import "server-only";

import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/lib/db";
import { clicks, linkSummaries, links } from "@/lib/db/schema";
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

export async function listLinks(): Promise<Result<LinkSummary[]>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    const rows = await config.db
      .select()
      .from(linkSummaries)
      .orderBy(desc(linkSummaries.created_at));
    return { ok: true, data: rows.map((link) => ({ ...link, tags: link.tags ?? [] })) };
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
}): Promise<Result<{ slug: string }>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    await config.db.insert(links).values(input);
    return { ok: true, data: { slug: input.slug } };
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

export type Destination = {
  id: string;
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

export async function saveTags(slug: string, tags: string[]): Promise<Result<null>> {
  const config = getDb();
  if (!config.ok) return unavailable(config);

  try {
    await config.db.update(links).set({ tags }).where(eq(links.slug, slug));
    return { ok: true, data: null };
  } catch (error) {
    return fail(error, "Could not save tags.");
  }
}

export async function insertClick(
  linkId: string,
  click: ClickDraft,
  tag: string | null,
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
