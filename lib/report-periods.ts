// The periods reports and the Overview offer, as local days including today (null: all time).
// Plain module, safe in the browser and on the server.
export const REPORT_RANGES = { today: 1, "7d": 7, "30d": 30, "90d": 90, all: null } as const;
export type ReportRange = keyof typeof REPORT_RANGES;
export const REPORT_PERIODS = Object.keys(REPORT_RANGES) as ReportRange[];
export const RANGE_LABELS: Record<ReportRange, string> = {
  today: "Today",
  "7d": "7 days",
  "30d": "30 days",
  "90d": "90 days",
  all: "All time",
};
