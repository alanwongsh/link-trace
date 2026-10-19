import {
  MAX_GROUP_BY,
  REPORT_RANGES,
  REPORT_ROW_LIMIT,
  type LinkReport,
  type ReportCell,
  type ReportParameter,
  type ReportRange,
} from "@/lib/report-data";
import { timezoneLabel } from "@/lib/timezones";

const RANGE_LABELS: Record<ReportRange, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", all: "All time" };

// Human visits to one link, grouped by the labels picked in the URL. Controls are plain links,
// like the tabs, so a report can be bookmarked or shared.
export function LinkReportView({
  slug,
  parameters,
  groupBy,
  range,
  report,
  labelledLinksHref,
  timezone,
}: {
  // The workspace timezone the period's days are counted in.
  timezone: string;
  slug: string;
  // Labels this link's labelled links use.
  parameters: ReportParameter[];
  groupBy: ReportParameter[];
  range: ReportRange;
  report: LinkReport;
  labelledLinksHref: string;
}) {
  const href = (by: ReportParameter[], r: ReportRange) => {
    const query = new URLSearchParams({ tab: "report", by: by.map((p) => p.key).join(","), range: r });
    return `/stats/${slug}?${query}`;
  };
  const csvHref = `/stats/${slug}/report?${new URLSearchParams({ by: groupBy.map((p) => p.key).join(","), range })}`;
  const picked = new Set(groupBy.map((p) => p.id));

  return (
    <section className="grid gap-5 rounded-2xl border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-serif text-2xl">Report</h2>
          <p className="mt-1 text-sm text-muted">
            Human visits to this link, grouped by the labels of the labelled link each visit came through.
          </p>
        </div>
        {report.totalClicks > 0 ? (
          <a href={csvHref} className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm font-semibold no-underline hover:border-teal">
            Export CSV
          </a>
        ) : null}
      </div>

      <div className="grid gap-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-muted">Group by</span>
          {parameters.length === 0 ? (
            <span className="text-muted">
              No labels yet.{" "}
              <a href={labelledLinksHref} className="text-teal hover:underline">
                Add labelled links
              </a>{" "}
              to compare by store, channel or campaign.
            </span>
          ) : (
            parameters.map((p) => {
              const on = picked.has(p.id);
              const full = !on && groupBy.length >= MAX_GROUP_BY;
              const next = on ? groupBy.filter((g) => g.id !== p.id) : [...groupBy, p];
              const pill = `rounded-full border px-3 py-1 ${
                on ? "border-teal bg-teal font-semibold text-white" : "border-line bg-paper text-ink hover:border-teal"
              }`;
              return full ? (
                <span key={p.id} className={`${pill} cursor-not-allowed opacity-50`} title={`Up to ${MAX_GROUP_BY} labels at once`}>
                  {p.name}
                </span>
              ) : (
                <a key={p.id} href={href(next, range)} aria-pressed={on} className={`${pill} no-underline`}>
                  {on ? "✓ " : "+ "}
                  {p.name}
                </a>
              );
            })
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="w-20 text-muted">Period</span>
          {(Object.keys(REPORT_RANGES) as ReportRange[]).map((r) => (
            <a
              key={r}
              href={href(groupBy, r)}
              aria-current={r === range ? "true" : undefined}
              className={`rounded-full px-3 py-1 no-underline ${r === range ? "bg-ink font-semibold text-card" : "text-muted hover:text-ink"}`}
            >
              {RANGE_LABELS[r]}
            </a>
          ))}
        </div>
      </div>

      {report.totalClicks === 0 ? (
        <p className="empty-state text-sm">No human visits in this period.</p>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="border-b border-line bg-paper text-xs text-muted">
              <tr>
                {groupBy.length === 0 ? (
                  <th scope="col" className="px-3 py-2 font-semibold">Came through</th>
                ) : (
                  groupBy.map((p) => (
                    <th key={p.id} scope="col" className="px-3 py-2 font-semibold">
                      {p.name}
                    </th>
                  ))
                )}
                <th scope="col" className="px-3 py-2 text-right font-semibold">Clicks</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Visitors</th>
                <th scope="col" className="w-40 px-3 py-2 font-semibold">Share of clicks</th>
              </tr>
            </thead>
            <tbody>
              {report.rows.map((row, index) => {
                const share = row.clicks / report.totalClicks;
                return (
                  <tr key={index} className="border-b border-line last:border-0">
                    {groupBy.length === 0 ? (
                      <td className="px-3 py-2">{row.direct ? <Muted>Main link</Muted> : "Labelled links"}</td>
                    ) : row.direct ? (
                      <td colSpan={groupBy.length} className="px-3 py-2">
                        <Muted>Main link, no labels</Muted>
                      </td>
                    ) : (
                      row.cells.map((cell, i) => (
                        <td key={i} className="px-3 py-2">
                          <Cell cell={cell} />
                        </td>
                      ))
                    )}
                    <td className="num px-3 py-2 text-right">{row.clicks.toLocaleString("en")}</td>
                    <td className="num px-3 py-2 text-right">{row.visitors.toLocaleString("en")}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-paper">
                          <div className="h-1.5 rounded-full bg-teal" style={{ width: `${Math.max(share * 100, 1)}%` }} />
                        </div>
                        <span className="num w-10 text-right text-xs text-muted">{Math.round(share * 100)}%</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-line bg-paper text-sm font-semibold">
              <tr>
                <td colSpan={Math.max(groupBy.length, 1)} className="px-3 py-2">
                  Total
                </td>
                <td className="num px-3 py-2 text-right">{report.totalClicks.toLocaleString("en")}</td>
                <td className="num px-3 py-2 text-right">{report.totalVisitors.toLocaleString("en")}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <p className="text-xs text-muted">
        Days in {timezoneLabel(timezone)}; the period ends today there. Bots are left out. Visitors are an estimate:
        one per browser per day, so someone who comes back on another day, clears cookies or changes browser counts
        again, and rows can add up to more than the total.
        {report.truncated ? ` Showing the top ${REPORT_ROW_LIMIT.toLocaleString("en")} rows; export the CSV for all.` : ""}
      </p>
    </section>
  );
}

function Cell({ cell }: { cell: ReportCell }) {
  if (!cell) return <Muted>Not set</Muted>;
  return (
    <>
      <span className="font-mono text-xs">{cell.value}</span>
      {cell.label ? <span className="text-muted"> · {cell.label}</span> : null}
    </>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span className="text-muted italic">{children}</span>;
}
