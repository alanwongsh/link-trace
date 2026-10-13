import { createHash } from "node:crypto";
import { notFound } from "next/navigation";
import { AddTagsForm } from "@/components/add-tags-form";
import { CopyButton } from "@/components/copy-button";
import { EditTargetForm } from "@/components/edit-target-form";
import { LinkTarget } from "@/components/link-target";
import { LocalTime } from "@/components/local-time";
import { PagePreview } from "@/components/page-preview";
import { QrButton } from "@/components/qr-button";
import { VisitorMap } from "@/components/visitor-map";
import { SetupGuide } from "@/components/setup-guide";
import { TopBar } from "@/components/top-bar";
import { findDestination, loadDetail } from "@/lib/data";
import { appOrigin } from "@/lib/origin";
import {
  browserLabel,
  countryName,
  formatDay,
  ipLabel,
  isLoopback,
  placeLabel,
} from "@/lib/track";

export const dynamic = "force-dynamic";

export default async function StatsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const result = await loadDetail(slug);
  if (!result.ok) {
    return (
      <>
        <TopBar authed />
        <main className="mx-auto max-w-5xl px-6 py-10">
          {result.missingConfig || result.missingSchema ? (
            <SetupGuide message={result.message} />
          ) : (
            <p className="text-sm text-warn">{result.message}</p>
          )}
        </main>
      </>
    );
  }
  if (!result.data) notFound();

  const detail = result.data;
  const destination = await findDestination(detail.link.slug);
  const target = destination.ok ? destination.data : null;
  // Changes when the page is edited, so the preview iframe reloads.
  const pageVersion = target?.html ? createHash("sha1").update(target.html).digest("hex").slice(0, 10) : "";
  const base = await appOrigin();
  const shortUrl = `${base}/r/${detail.link.slug}`;
  const maxClicks = Math.max(...detail.daily.map((day) => day.clicks), 0);

  return (
    <>
      <TopBar authed meta={`${detail.unique_visitors} visitors`} />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div>
          <a href="/" className="text-sm text-teal">
            All links
          </a>
          <h1 className="mt-3 font-serif text-4xl tracking-tight">
            {detail.link.title || detail.link.slug}
          </h1>
          <p className="mt-2 flex flex-wrap items-center gap-3 text-sm">
            <span className="font-mono text-teal">{shortUrl}</span>
            <CopyButton value={shortUrl} />
          </p>
          <LinkTarget slug={detail.link.slug} kind={detail.link.kind} url={detail.link.url} />
        </div>

        {detail.link.kind === "page" ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <PagePreview
              key={pageVersion}
              src={`/stats/${detail.link.slug}/preview?v=${pageVersion}`}
              title={`Preview of ${detail.link.slug}`}
            />
          </section>
        ) : null}

        {target ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <EditTargetForm
              slug={detail.link.slug}
              kind={target.kind}
              url={target.url}
              html={target.html}
            />
          </section>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Clicks" value={detail.total_clicks} hint={`${detail.clicks_7d} in 7 days`} />
          <Stat label="Visitors" value={detail.unique_visitors} hint="Distinct browser ids" />
          <Stat label="IP addresses" value={detail.unique_ips} hint={`${detail.clicks_today} clicks today`} />
          <Stat label="Bot hits" value={detail.bot_clicks} hint="Left out of the other counts" />
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Platforms</h2>
          <p className="mt-1 text-sm text-muted">
            Share a tagged link for each platform. Visits to the plain link stay untagged.
          </p>
          <ul className="mt-4 grid gap-3">
            {detail.tag_stats.map((row) => (
              <PlatformRow
                key={row.tag}
                slug={detail.link.slug}
                tag={row.tag}
                label={row.tag}
                url={`${shortUrl}/${row.tag}`}
                clicks={row.clicks}
                visitors={row.visitors}
              />
            ))}
            <PlatformRow
              slug={detail.link.slug}
              label="Untagged"
              url={shortUrl}
              clicks={detail.untagged_clicks}
              visitors={detail.untagged_visitors}
            />
          </ul>
          <AddTagsForm slug={detail.link.slug} />
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Last 14 days</h2>
          <p className="mt-1 text-sm text-muted">Human visits only. Days are grouped in UTC.</p>
          <div className="mt-6 flex h-36 items-end gap-1.5">
            {detail.daily.map((day) => {
              const height = maxClicks === 0 ? 4 : Math.max(4, (day.clicks / maxClicks) * 100);
              return (
                <div key={day.day} className="flex h-full flex-1 flex-col justify-end" title={`${formatDay(day.day)}: ${day.clicks}`}>
                  <div
                    className="rounded-sm bg-teal"
                    style={{ height: `${height}%`, opacity: day.clicks === 0 ? 0.25 : 1 }}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted">
            <span>{detail.daily[0] ? formatDay(detail.daily[0].day) : ""}</span>
            <span>{detail.daily.at(-1) ? formatDay(detail.daily.at(-1)!.day) : ""}</span>
          </div>
        </section>

        <VisitorMap countries={detail.countries} />

        <section className="grid gap-4 lg:grid-cols-2">
          <Breakdown
            title="Places"
            rows={detail.countries.slice(0, 8).map((row) => ({
              label: row.country === "Unknown" ? "No location" : countryName(row.country),
              clicks: row.clicks,
            }))}
          />
          <Breakdown
            title="Referrers"
            rows={detail.referrers.map((row) => ({
              label: row.referrer,
              clicks: row.clicks,
            }))}
          />
        </section>

        <section className="grid gap-3">
          <h2 className="font-serif text-2xl">Recent visits</h2>
          {detail.recent.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-muted">
              No visits yet.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-card">
              <table className="w-full min-w-[760px] text-left text-sm">
                <thead className="border-b border-line text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Platform</th>
                    <th className="px-4 py-3 font-medium">IP</th>
                    <th className="px-4 py-3 font-medium">Visitor</th>
                    <th className="px-4 py-3 font-medium">Place</th>
                    <th className="px-4 py-3 font-medium">Referrer</th>
                    <th className="px-4 py-3 font-medium">Browser</th>
                  </tr>
                </thead>
                <tbody>
                  {detail.recent.map((click, index) => (
                    <tr key={`${click.clicked_at}-${click.visitor_id}-${index}`} className="border-b border-line last:border-0">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <LocalTime iso={click.clicked_at} />
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{click.tag || "—"}</td>
                      <td className="px-4 py-3 font-mono text-xs" title={click.ip || ""}>
                        {ipLabel(click.ip)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs" title={click.visitor_id}>
                        {click.visitor_id.slice(0, 8)}
                        {click.is_bot ? <span className="ml-2 text-warn">bot</span> : null}
                      </td>
                      <td className="px-4 py-3">{isLoopback(click.ip) ? "Local" : placeLabel(click)}</td>
                      <td className="max-w-[180px] truncate px-4 py-3" title={click.referrer || "Direct"}>
                        {click.referrer || "Direct"}
                      </td>
                      <td className="px-4 py-3" title={click.user_agent || ""}>
                        {browserLabel(click.user_agent)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </>
  );
}

function PlatformRow({
  slug,
  tag,
  label,
  url,
  clicks,
  visitors,
}: {
  slug: string;
  tag?: string;
  label: string;
  url: string;
  clicks: number;
  visitors: number;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
      <div className="min-w-0">
        <p className="font-medium">{label}</p>
        <p className="truncate font-mono text-xs text-teal">{url}</p>
      </div>
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <p>
          <span className="num">{clicks}</span> <span className="text-muted">clicks</span>
        </p>
        <p>
          <span className="num">{visitors}</span> <span className="text-muted">visitors</span>
        </p>
        <CopyButton value={url} />
        <QrButton slug={slug} tag={tag} url={url} />
      </div>
    </li>
  );
}

function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <article className="rounded-2xl border border-line bg-card px-4 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-1 font-serif text-4xl">{value}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </article>
  );
}

function Breakdown({
  title,
  rows,
}: {
  title: string;
  rows: { label: string; clicks: number }[];
}) {
  const max = Math.max(...rows.map((row) => row.clicks), 0);
  return (
    <article className="rounded-2xl border border-line bg-card p-5">
      <h2 className="font-serif text-2xl">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">No visits yet.</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="truncate">{row.label}</span>
                <span className="num text-muted">{row.clicks}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-paper">
                <div
                  className="h-1.5 rounded-full bg-teal"
                  style={{ width: `${max === 0 ? 0 : (row.clicks / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}
