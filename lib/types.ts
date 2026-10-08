export type LinkSummary = {
  id: string;
  slug: string;
  url: string;
  title: string | null;
  tags: string[];
  created_at: string;
  click_count: number;
  visitor_count: number;
  ip_count: number;
};

export type RecentClick = {
  visitor_id: string;
  ip: string | null;
  user_agent: string | null;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  is_bot: boolean;
  tag: string | null;
  clicked_at: string;
};

export type TagStat = {
  tag: string;
  clicks: number;
  visitors: number;
};

export type LinkDetail = {
  link: {
    id: string;
    slug: string;
    url: string;
    title: string | null;
    tags: string[];
    created_at: string;
  };
  untagged_clicks: number;
  untagged_visitors: number;
  tag_stats: TagStat[];
  total_clicks: number;
  unique_visitors: number;
  unique_ips: number;
  clicks_today: number;
  clicks_7d: number;
  bot_clicks: number;
  daily: { day: string; clicks: number }[];
  countries: { country: string; clicks: number }[];
  referrers: { referrer: string; clicks: number }[];
  recent: RecentClick[];
};

export type CreateState = {
  error: string;
  slug: string;
};

export type TagState = {
  error: string;
  added: string;
};

export type Failure = {
  ok: false;
  message: string;
  missingConfig?: boolean;
  missingSchema?: boolean;
};

export type Result<T> = { ok: true; data: T } | Failure;

export function schemaProblem(message: string): boolean {
  return /schema cache|does not exist|link_summaries|link_detail|PGRST20[45]/i.test(
    message,
  );
}
