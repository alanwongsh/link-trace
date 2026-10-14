-- Expose workspace_id and created_by on the dashboard view. New view columns must go last.
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
  count(distinct c.ip) filter (where not c.is_bot)::int as ip_count,
  l.kind,
  l.workspace_id,
  l.created_by
from public.links l
left join public.clicks c on c.link_id = l.id
group by l.id;
