-- View and stats function used by lib/data.ts. Plain Postgres, safe to re-run.
-- Row level security stays on with no policies: the app connects as the table owner, which bypasses it,
-- while Supabase's public API roles (anon, authenticated) get nothing.
ALTER TABLE "links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "clicks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE OR REPLACE VIEW "link_summaries"
WITH (security_invoker = true) AS
select
  l.id,
  l.slug,
  l.url,
  l.title,
  l.tags,
  l.created_at,
  count(c.id) filter (where c.id is not null and not c.is_bot)::int as click_count,
  count(distinct c.visitor_id) filter (where not c.is_bot)::int as visitor_count,
  count(distinct c.ip) filter (where not c.is_bot)::int as ip_count
from public.links l
left join public.clicks c on c.link_id = l.id
group by l.id;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION "link_detail"(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select id, slug, url, title, tags, created_at
    from links
    where slug = p_slug
  ),
  scoped as (
    select c.*
    from clicks c
    join target t on t.id = c.link_id
  ),
  humans as (
    select * from scoped where not is_bot
  ),
  daily as (
    select
      to_char(series.day, 'YYYY-MM-DD') as day,
      count(h.id)::int as clicks
    from generate_series(
      date_trunc('day', (now() at time zone 'utc')) - interval '13 days',
      date_trunc('day', (now() at time zone 'utc')),
      interval '1 day'
    ) as series(day)
    left join humans h
      on (h.clicked_at at time zone 'utc') >= series.day
     and (h.clicked_at at time zone 'utc') < series.day + interval '1 day'
    group by series.day
  )
  select case
    when not exists (select 1 from target) then null
    else jsonb_build_object(
      'link', (
        select jsonb_build_object(
          'id', id,
          'slug', slug,
          'url', url,
          'title', title,
          'tags', coalesce(to_jsonb(tags), '[]'::jsonb),
          'created_at', created_at
        )
        from target
      ),
      'untagged_clicks', (select count(*)::int from humans where tag is null),
      'untagged_visitors', (select count(distinct visitor_id)::int from humans where tag is null),
      'tag_stats', coalesce((
        select jsonb_agg(
          jsonb_build_object('tag', tag, 'clicks', clicks, 'visitors', visitors)
          order by clicks desc, tag
        )
        from (
          select
            listed.tag,
            count(h.id)::int as clicks,
            count(distinct h.visitor_id)::int as visitors
          from (
            select distinct unnest(coalesce(tags, '{}')) as tag
            from target
          ) listed
          left join humans h on h.tag = listed.tag
          group by listed.tag
        ) grouped
      ), '[]'::jsonb),
      'total_clicks', (select count(*)::int from humans),
      'unique_visitors', (select count(distinct visitor_id)::int from humans),
      'unique_ips', (select count(distinct ip)::int from humans),
      'clicks_today', (
        select count(*)::int from humans
        where clicked_at >= date_trunc('day', now())
      ),
      'clicks_7d', (
        select count(*)::int from humans
        where clicked_at >= now() - interval '7 days'
      ),
      'bot_clicks', (select count(*)::int from scoped where is_bot),
      'daily', coalesce((
        select jsonb_agg(
          jsonb_build_object('day', day, 'clicks', clicks)
          order by day
        )
        from daily
      ), '[]'::jsonb),
      'countries', coalesce((
        select jsonb_agg(
          jsonb_build_object('country', country, 'clicks', clicks)
          order by clicks desc
        )
        from (
          select coalesce(nullif(country, ''), 'Unknown') as country, count(*)::int as clicks
          from humans
          group by 1
          order by clicks desc
          limit 50
        ) grouped
      ), '[]'::jsonb),
      'referrers', coalesce((
        select jsonb_agg(
          jsonb_build_object('referrer', referrer, 'clicks', clicks)
          order by clicks desc
        )
        from (
          select coalesce(nullif(referrer, ''), 'Direct') as referrer, count(*)::int as clicks
          from humans
          group by 1
          order by clicks desc
          limit 8
        ) grouped
      ), '[]'::jsonb),
      'recent', coalesce((
        select jsonb_agg(
          jsonb_build_object(
            'visitor_id', visitor_id,
            'ip', ip,
            'user_agent', user_agent,
            'referrer', referrer,
            'country', country,
            'region', region,
            'city', city,
            'is_bot', is_bot,
            'tag', tag,
            'clicked_at', clicked_at
          )
          order by clicked_at desc
        )
        from (
          select *
          from scoped
          order by clicked_at desc
          limit 50
        ) recent_rows
      ), '[]'::jsonb)
    )
  end;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION "link_detail"(text) FROM PUBLIC;--> statement-breakpoint
-- Supabase only: these roles do not exist on a plain Postgres server.
DO $$
BEGIN
	IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
		REVOKE ALL ON FUNCTION "link_detail"(text) FROM anon, authenticated;
		REVOKE ALL ON "links", "clicks", "link_summaries" FROM anon, authenticated;
	END IF;
END $$;
