// The Overview cards a viewer can show or hide, and how their choice is kept. Plain module, safe
// in the browser (the Customize panel) and on the server (which draws the chosen cards).
import { REPORT_PERIODS, type ReportRange } from "./report-periods";

// The cards a viewer can show or hide on the Overview. Labels are added per link, as "label:<key>".
export const FIXED_CARDS = ["combos", "places", "referrers", "map", "recent"] as const;
export const CARD_NAMES: Record<(typeof FIXED_CARDS)[number], string> = {
  combos: "Top combinations",
  places: "Places",
  referrers: "Referrers",
  map: "Map",
  recent: "Recent visits",
};
export const labelCard = (key: string) => `label:${key}`;

// A viewer's Overview layout, kept in a cookie so the server draws it straight away. Hidden cards
// are stored rather than shown ones, so a label added later appears without anyone ticking it.
export const LAYOUT_COOKIE = "lt_overview";
export type OverviewLayout = { period: ReportRange; hidden: string[] };

export function readLayout(raw: string | undefined): OverviewLayout {
  const fallback: OverviewLayout = { period: "7d", hidden: [] };
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw) as Partial<OverviewLayout>;
    const period = REPORT_PERIODS.find((r) => r === parsed.period) ?? fallback.period;
    const hidden = Array.isArray(parsed.hidden) ? parsed.hidden.filter((c): c is string => typeof c === "string").slice(0, 100) : [];
    return { period, hidden };
  } catch {
    return fallback;
  }
}
