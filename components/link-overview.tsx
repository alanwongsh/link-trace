import { Bars, Breakdown, Stat } from "@/components/charts";
import { OverviewCustomize } from "@/components/overview-customize";
import { VisitorMap } from "@/components/visitor-map";
import type { LinkOverview } from "@/lib/overview-data";
import { CARD_NAMES, FIXED_CARDS, labelCard, type OverviewLayout } from "@/lib/overview-layout";
import type { LinkReport, ReportParameter } from "@/lib/report-data";
import { RANGE_LABELS, REPORT_PERIODS, type ReportRange } from "@/lib/report-periods";
import { timezoneLabel, timezoneOffset } from "@/lib/timezones";
import { countryName, formatDay } from "@/lib/track";

// Rows in each top card.
const TOP_ROWS = 5;

// The Overview tab: totals for a period with the change from the period before, the trend, and
// the cards the viewer chose (top values per label, top combinations, and so on).
export function LinkOverviewView({
  slug,
  timezone,
  range,
  layout,
  overview,
  labels,
  combos,
  recent,
}: {
  slug: string;
  timezone: string;
  range: ReportRange;
  layout: OverviewLayout;
  overview: LinkOverview;
  // One per label this link's labelled links use, with its grouped report for the period.
  labels: { parameter: ReportParameter; report: LinkReport }[];
  // Grouped by every label at once; null when the link has none.
  combos: LinkReport | null;
  // The recent visits table, drawn by the page.
  recent: React.ReactNode;
}) {
  const hidden = new Set(layout.hidden);
  const show = (card: string) => !hidden.has(card);
  const cards = [
    ...labels.map((l) => ({ key: labelCard(l.parameter.key), name: `Top ${l.parameter.name}` })),
    ...FIXED_CARDS.filter((c) => c !== "combos" || labels.length > 1).map((c) => ({ key: c, name: CARD_NAMES[c] })),
  ];
  const reportHref = (by: string) => `/stats/${slug}?${new URLSearchParams({ tab: "report", by, range })}`;
  const total = overview.totals.clicks;
  const previousName = range === "today" ? "yesterday" : `the ${RANGE_LABELS[range].toLowerCase()} before`;

  const topCards = [
    ...labels
      .filter((l) => show(labelCard(l.parameter.key)))
      .map((l) => (
        <Breakdown
          key={l.parameter.id}
          title={`Top ${l.parameter.name}`}
          total={total}
          rows={l.report.rows
            .filter((r) => !r.direct)
            .slice(0, TOP_ROWS)
            .map((r) => ({ label: r.cells[0]?.value ?? "Not set", note: r.cells[0]?.label ?? undefined, clicks: r.clicks }))}
          empty="No visits through labelled links in this period."
          more={{ href: reportHref(l.parameter.key), label: "See full report →" }}
        />
      )),
    combos && labels.length > 1 && show("combos") ? (
      <Breakdown
        key="combos"
        title="Top combinations"
        total={total}
        rows={combos.rows
          .filter((r) => !r.direct)
          .slice(0, TOP_ROWS)
          .map((r) => ({ label: r.cells.map((c) => c?.value ?? "–").join(" · "), clicks: r.clicks }))}
        empty="No visits through labelled links in this period."
        more={{ href: reportHref(labels.map((l) => l.parameter.key).join(",")), label: "See full report →" }}
      />
    ) : null,
  ].filter(Boolean);

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label="Period" className="flex flex-wrap gap-1 text-sm">
          {REPORT_PERIODS.map((p) => (
            <a
              key={p}
              href={`/stats/${slug}?period=${p}`}
              aria-current={p === range ? "true" : undefined}
              className={`rounded-full px-3 py-1 no-underline ${p === range ? "bg-ink font-semibold text-card" : "text-muted hover:text-ink"}`}
            >
              {RANGE_LABELS[p]}
            </a>
          ))}
        </nav>
        <OverviewCustomize cards={cards} layout={layout} />
      </div>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals">
        <Stat label="Clicks" value={total} hint={change(total, overview.previous?.clicks, previousName)} />
        <Stat
          label="Visitors"
          value={overview.totals.visitors}
          hint={change(overview.totals.visitors, overview.previous?.visitors, previousName) || "Distinct browsers, per day"}
        />
        <Stat
          label="Labelled links used"
          value={overview.labelledUsed}
          hint={`of ${overview.labelledActive.toLocaleString("en")} active had visits`}
        />
        <Stat label="Bot hits" value={overview.totals.botClicks} hint="Left out of the other counts" />
      </section>

      <section className="panel">
        <h2 className="panel-title">{range === "today" ? "Today by hour" : range === "all" ? "By month" : `Last ${RANGE_LABELS[range].toLowerCase()}`}</h2>
        <p className="mt-1 text-sm text-muted">Human visits only. Times in {timezoneLabel(timezone)}.</p>
        <Bars
          bars={overview.trend.map((t) => ({ key: t.key, label: trendLabel(t.key, overview.granularity), clicks: t.clicks }))}
          label={`Human visits, ${RANGE_LABELS[range].toLowerCase()}`}
          unit={`${overview.granularity === "hour" ? "Hour" : overview.granularity === "month" ? "Month" : "Day"} (${timezoneOffset(timezone)})`}
        />
      </section>

      {topCards.length > 0 ? <section className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">{topCards}</section> : null}

      {show("map") ? <VisitorMap countries={overview.countries} /> : null}

      {show("places") || show("referrers") ? (
        <section className="grid gap-4 lg:grid-cols-2">
          {show("places") ? (
            <Breakdown
              title="Places"
              total={total}
              rows={overview.countries.slice(0, 8).map((row) => ({
                label: row.country === "Unknown" ? "No location" : countryName(row.country),
                clicks: row.clicks,
              }))}
            />
          ) : null}
          {show("referrers") ? (
            <Breakdown title="Referrers" total={total} rows={overview.referrers.map((row) => ({ label: row.referrer, clicks: row.clicks }))} />
          ) : null}
        </section>
      ) : null}

      {show("recent") ? recent : null}
    </div>
  );
}

// "▲ 18% vs the 7 days before", or "" when there is nothing to compare with.
function change(now: number, before: number | undefined, previousName: string): string {
  if (before === undefined) return "";
  if (before === 0) return now === 0 ? `None ${previousName} either` : `New since ${previousName}`;
  const pct = Math.round(((now - before) / before) * 100);
  return pct === 0 ? `Same as ${previousName}` : `${pct > 0 ? "▲" : "▼"} ${Math.abs(pct)}% vs ${previousName}`;
}

function trendLabel(key: string, granularity: LinkOverview["granularity"]): string {
  if (granularity === "hour") return `${key}:00`;
  if (granularity === "day") return formatDay(key);
  const [year, month] = key.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, 1)));
}
