import "server-only";

import { getSupabase } from "@/lib/supabase";
import type { ClickDraft } from "@/lib/track";
import {
  schemaProblem,
  type Failure,
  type LinkDetail,
  type LinkSummary,
  type Result,
} from "@/lib/types";

function fail(error: { message: string }, fallback: string): Failure {
  const message = error.message || fallback;
  if (/permission denied/i.test(message)) {
    return {
      ok: false,
      message:
        "Supabase refused this API key. Use the secret key from Project Settings → API Keys. It starts with sb_secret_. The publishable key cannot read the visitor log.",
    };
  }
  return {
    ok: false,
    message,
    missingSchema: schemaProblem(message),
  };
}

function unavailable(config: { message: string; missingConfig?: boolean }): Failure {
  return { ok: false, message: config.message, missingConfig: config.missingConfig };
}

export async function listLinks(): Promise<Result<LinkSummary[]>> {
  const supabase = getSupabase();
  if (!supabase.ok) return unavailable(supabase);

  const { data, error } = await supabase.client
    .from("link_summaries")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) return fail(error, "Could not load links.");
  const links = ((data ?? []) as LinkSummary[]).map((link) => ({
    ...link,
    tags: Array.isArray(link.tags) ? link.tags : [],
  }));
  return { ok: true, data: links };
}

export async function insertLink(input: {
  slug: string;
  url: string;
  title: string | null;
  tags: string[];
}): Promise<Result<{ slug: string }>> {
  const supabase = getSupabase();
  if (!supabase.ok) return unavailable(supabase);

  const { error } = await supabase.client.from("links").insert(input);
  if (error) {
    if (error.code === "23505") {
      return { ok: false, message: "That slug is already in use." };
    }
    return fail(error, "Could not create the link.");
  }
  return { ok: true, data: { slug: input.slug } };
}

export async function deleteLink(slug: string): Promise<Result<null>> {
  const supabase = getSupabase();
  if (!supabase.ok) return unavailable(supabase);

  const { error } = await supabase.client.from("links").delete().eq("slug", slug);
  if (error) return fail(error, "Could not delete the link.");
  return { ok: true, data: null };
}

export async function findDestination(
  slug: string,
): Promise<Result<{ id: string; url: string; tags: string[] } | null>> {
  const supabase = getSupabase();
  if (!supabase.ok) return unavailable(supabase);

  const { data, error } = await supabase.client
    .from("links")
    .select("id, url, tags")
    .eq("slug", slug)
    .maybeSingle();

  if (error) return fail(error, "Could not load the link.");
  if (!data) return { ok: true, data: null };
  const row = data as { id: string; url: string; tags: string[] | null };
  return {
    ok: true,
    data: { id: row.id, url: row.url, tags: Array.isArray(row.tags) ? row.tags : [] },
  };
}

export async function saveTags(slug: string, tags: string[]): Promise<Result<null>> {
  const supabase = getSupabase();
  if (!supabase.ok) return unavailable(supabase);

  const { error } = await supabase.client.from("links").update({ tags }).eq("slug", slug);
  if (error) return fail(error, "Could not save tags.");
  return { ok: true, data: null };
}

export async function insertClick(
  linkId: string,
  click: ClickDraft,
  tag: string | null,
): Promise<void> {
  const supabase = getSupabase();
  if (!supabase.ok) return;

  const { error } = await supabase.client.from("clicks").insert({
    link_id: linkId,
    visitor_id: click.visitorId,
    ip: click.ip,
    user_agent: click.userAgent,
    referrer: click.referrer,
    country: click.country,
    region: click.region,
    city: click.city,
    is_bot: click.isBot,
    tag,
  });
  if (error) console.error("Failed to record click:", error.message);
}

export async function loadDetail(slug: string): Promise<Result<LinkDetail | null>> {
  const supabase = getSupabase();
  if (!supabase.ok) return unavailable(supabase);

  const { data, error } = await supabase.client.rpc("link_detail", {
    p_slug: slug,
  });

  if (error) return fail(error, "Could not load stats.");
  if (!data) return { ok: true, data: null };
  const parsed = typeof data === "string" ? (JSON.parse(data) as LinkDetail) : (data as LinkDetail);
  return { ok: true, data: normalizeDetail(parsed) };
}

function normalizeDetail(detail: LinkDetail): LinkDetail {
  return {
    ...detail,
    link: {
      ...detail.link,
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
