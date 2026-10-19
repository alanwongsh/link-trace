export type LinkKind = "redirect" | "page";

export type LinkSummary = {
  id: string;
  slug: string;
  kind: LinkKind;
  url: string | null;
  title: string | null;
  tags: string[];
  created_at: string;
  click_count: number;
  visitor_count: number;
  ip_count: number;
  workspace_id: string;
  workspace_name: string;
  created_by: string | null;
  created_by_name: string | null;
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
    kind: LinkKind;
    url: string | null;
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
  // Set when a first placement was created with the link.
  placementCode?: string;
  // Per parameter key, when the first placement's values were rejected.
  fieldErrors?: Record<string, string>;
};

// For simple forms: one error or one success message.
export type FormState = {
  error: string;
  ok: string;
};

export type EditState = {
  error: string;
  savedAt: number;
};

export type TagState = {
  error: string;
  added: string;
};

export type PlacementState = {
  error: string;
  // Per parameter key, when values were rejected.
  fieldErrors: Record<string, string>;
  // The new placement's code after a successful create.
  code: string;
};

export type BulkState = {
  error: string;
  // After a check: rows ready to create, and the problems found (first ones only).
  checked: boolean;
  ready: number;
  problems: { line: number; message: string }[];
  problemCount: number;
  // Up to five rows as "label: value" lists, to confirm the columns were read correctly.
  sample: string[][];
  // Set once the upload is queued.
  jobId: string;
};

export type Failure = {
  ok: false;
  message: string;
  missingConfig?: boolean;
  missingSchema?: boolean;
};

export type Result<T> = { ok: true; data: T } | Failure;

export function schemaProblem(message: string): boolean {
  return /does not exist|link_summaries|link_detail/i.test(
    message,
  );
}
