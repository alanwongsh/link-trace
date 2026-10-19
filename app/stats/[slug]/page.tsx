import { createHash } from "node:crypto";
import { FormSelect } from "@/components/form-select";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { CopyButton } from "@/components/copy-button";
import { EditTargetForm } from "@/components/edit-target-form";
import { LinkOverviewView } from "@/components/link-overview";
import { LinkReportView } from "@/components/link-report";
import { LinkTarget } from "@/components/link-target";
import { ListFilters, Pagination, readPage } from "@/components/list-controls";
import { LocalTime } from "@/components/local-time";
import { PagePreview } from "@/components/page-preview";
import { PlacementForm } from "@/components/placement-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { BulkPlacementForm } from "@/components/bulk-placement-form";
import { QrButton } from "@/components/qr-button";
import { RevealPanels } from "@/components/reveal-panels";
import { Tabs } from "@/components/tabs";
import { SetupGuide } from "@/components/setup-guide";
import { TopBar } from "@/components/top-bar";
import { listWorkspaces } from "@/lib/accounts";
import { moveLinkToWorkspace } from "@/lib/actions";
import { allowed, can, requireUser } from "@/lib/auth";
import { findDestination, linkOwnership, loadDetail } from "@/lib/data";
import { placementFields } from "@/lib/parameter-data";
import { setPlacementStatus } from "@/lib/placement-actions";
import { countPlacements, pagePlacements } from "@/lib/placement-data";
import { listBulkJobs } from "@/lib/bulk-data";
import { loadOverview } from "@/lib/overview-data";
import { LAYOUT_COOKIE, labelCard, readLayout } from "@/lib/overview-layout";
import { REPORT_PERIODS } from "@/lib/report-periods";
import {
  filterValues,
  keepRollupCurrent,
  linkReport,
  readReportQuery,
  reportFilterOptions,
  reportParameters,
} from "@/lib/report-data";
import { jobsRunInline } from "@/lib/queue";
import { appOrigin } from "@/lib/origin";
import {
  browserLabel,
  ipLabel,
  isLoopback,
  placeLabel,
} from "@/lib/track";

export const dynamic = "force-dynamic";
// Bulk uploads run after this page's actions respond; Vercel caps this at the plan's limit.
export const maxDuration = 300;
// Labelled links listed per page on the link page.
const LINKS_PAGE_SIZE = 25;

export default async function StatsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const { slug } = await params;
  // Report filters arrive as repeated f_<label key> values; everything else is one value.
  const rawQuery = await searchParams;
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
  const query = {
    tab: first(rawQuery.tab),
    by: first(rawQuery.by),
    range: first(rawQuery.range),
    q: first(rawQuery.q),
    status: first(rawQuery.status),
    page: first(rawQuery.page),
    period: first(rawQuery.period),
  };
  const result = await loadDetail(slug);
  if (!result.ok) {
    return (
      <>
        <TopBar />
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
  // Every tab reads the daily totals; with the inline queue this starts a rollup when they are behind.
  await keepRollupCurrent();
  // Links outside the user's workspaces look the same as missing ones.
  const ownership = await linkOwnership(detail.link.slug);
  if (!ownership || !can(user, ownership.workspaceId, "viewer")) notFound();
  const isOwner = can(user, ownership.workspaceId, "owner");
  const moveTargets = isOwner
    ? (user.isOrgAdmin
        ? await listWorkspaces()
        : user.memberships
            .filter((m) => m.role === "owner")
            .map((m) => ({ id: m.workspaceId, name: m.workspaceName }))
      ).filter((w) => w.id !== ownership.workspaceId)
    : [];

  const destination = await findDestination(detail.link.slug);
  const target = destination.ok ? destination.data : null;
  // Changes when the page is edited, so the preview iframe reloads.
  const pageVersion = target?.html ? createHash("sha1").update(target.html).digest("hex").slice(0, 10) : "";
  const base = await appOrigin();
  const shortUrl = `${base}/r/${detail.link.slug}`;
  const canPlace = allowed(user, ownership.workspaceId, "placements.manage");
  const [placementCount, fields, bulkJobs] = await Promise.all([
    countPlacements(detail.link.id),
    canPlace ? placementFields(ownership.workspaceId) : Promise.resolve([]),
    listBulkJobs(detail.link.id),
  ]);
  const bulkRunning = bulkJobs.some((job) => job.status === "queued" || job.status === "running");
  // A job still queued after two minutes usually means no worker is running.
  // Inline uploads run in the request; one still unfinished after 10 minutes was cut off by the
  // host's time limit. With a worker queue, one still waiting after 2 minutes means no worker.
  const inline = jobsRunInline();
  const stalled = bulkJobs.some((job) => {
    const age = Date.now() - new Date(job.createdAt).getTime();
    return inline
      ? (job.status === "queued" || job.status === "running") && age > 10 * 60 * 1000
      : job.status === "queued" && age > 2 * 60 * 1000;
  });
  // The page has three jobs: reading the numbers, managing labelled links, and changing the link.
  const hasSettings = detail.link.kind === "page" || (Boolean(target) && isOwner) || moveTargets.length > 0;
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "report", label: "Report" },
    { key: "links", label: "Labelled links", count: placementCount },
    ...(hasSettings ? [{ key: "settings", label: "Settings" }] : []),
  ];
  const tab = tabs.find((t) => t.key === query.tab)?.key ?? "overview";
  const tabHref = (key: string) => (key === "overview" ? `/stats/${detail.link.slug}` : `/stats/${detail.link.slug}?tab=${key}`);

  // The report is only queried on its own tab.
  const reportData =
    tab === "report"
      ? await (async () => {
          const parameters = await reportParameters(detail.link.id);
          const { groupBy, range, filters } = readReportQuery(
            { by: query.by, range: query.range, filters: filterValues(Object.entries(rawQuery)) },
            parameters,
            parameters.slice(0, 1),
          );
          const [report, filterOptions] = await Promise.all([
            linkReport(detail.link.id, groupBy.map((p) => p.id), range, {
              filters: filters.map((f) => ({ parameterId: f.parameter.id, values: f.values })),
            }),
            reportFilterOptions(detail.link.id),
          ]);
          return { parameters, groupBy, range, filters, filterOptions, report };
        })()
      : null;

  // The Overview's period numbers and the cards this viewer shows, only on its tab.
  const overviewData =
    tab === "overview"
      ? await (async () => {
          const layout = readLayout((await cookies()).get(LAYOUT_COOKIE)?.value);
          const range = REPORT_PERIODS.find((p) => p === query.period) ?? layout.period;
          const hidden = new Set(layout.hidden);
          const parameters = await reportParameters(detail.link.id);
          const shown = parameters.filter((p) => !hidden.has(labelCard(p.key)));
          const [overview, labels, combos] = await Promise.all([
            loadOverview(detail.link.id, range),
            Promise.all(shown.map(async (parameter) => ({ parameter, report: await linkReport(detail.link.id, [parameter.id], range) }))),
            parameters.length > 1 && !hidden.has("combos")
              ? linkReport(detail.link.id, parameters.map((p) => p.id), range)
              : Promise.resolve(null),
          ]);
          return {
            layout,
            range,
            overview,
            labels,
            combos,
          };
        })()
      : null;

  // One page of labelled links, only on their tab.
  const linkFilters = {
    q: (query.q ?? "").trim(),
    status: (["active", "inactive"] as const).find((s) => s === query.status) ?? ("all" as const),
    page: readPage(query.page),
  };
  const linksPage =
    tab === "links"
      ? await pagePlacements(detail.link.id, {
          q: linkFilters.q,
          status: linkFilters.status,
          limit: LINKS_PAGE_SIZE,
          offset: (linkFilters.page - 1) * LINKS_PAGE_SIZE,
        })
      : null;
  const linksPageHref = (n: number) =>
    `/stats/${detail.link.slug}?${new URLSearchParams({
      tab: "links",
      ...(linkFilters.q ? { q: linkFilters.q } : {}),
      ...(linkFilters.status !== "all" ? { status: linkFilters.status } : {}),
      page: String(n),
    })}`;

  return (
    <>
      <TopBar meta={`${detail.unique_visitors} visitors`} />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-6">
          <div>
            <a href="/" className="text-sm text-teal">
              All links
            </a>
            <div className="mt-3 flex flex-wrap items-end justify-between gap-4">
              <div className="min-w-0">
                <h1 className="font-serif text-4xl tracking-tight">{detail.link.title || detail.link.slug}</h1>
                <p className="mt-2 truncate font-mono text-teal">{shortUrl}</p>
                <LinkTarget slug={detail.link.slug} kind={detail.link.kind} url={detail.link.url} />
                <p className="mt-2 text-sm text-muted">
                  {ownership.workspaceName}
                  {ownership.createdByName ? ` · created by ${ownership.createdByName}` : ""}
                  {ownership.updatedAt ? (
                    <>
                      {" · last changed "}
                      {ownership.updatedByName ? `by ${ownership.updatedByName} ` : ""}
                      <LocalTime iso={ownership.updatedAt} />
                    </>
                  ) : null}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton value={shortUrl} />
                <QrButton slug={detail.link.slug} url={shortUrl} />
              </div>
            </div>
          </div>
          <Tabs
            label="Link sections"
            tabs={tabs.map((t) => ({ href: tabHref(t.key), label: t.label, count: t.count, current: t.key === tab }))}
          />
        </div>

        {overviewData ? (
          <LinkOverviewView
            slug={detail.link.slug}
            timezone={detail.timezone}
            range={overviewData.range}
            layout={overviewData.layout}
            overview={overviewData.overview}
            labels={overviewData.labels}
            combos={overviewData.combos}
            recent={
            <section className="grid gap-3">
              <h2 className="sub-title">Recent visits</h2>
              {detail.recent.length === 0 ? (
                <p className="empty-state">No visits yet.</p>
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
                            <LocalTime iso={click.clicked_at} timeZone={detail.timezone} />
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
            }
          />
        ) : null}

        {reportData ? (
          <LinkReportView
            slug={detail.link.slug}
            parameters={reportData.parameters}
            groupBy={reportData.groupBy}
            range={reportData.range}
            report={reportData.report}
            labelledLinksHref={tabHref("links")}
            timezone={detail.timezone}
            filters={reportData.filters}
            filterOptions={reportData.filterOptions}
          />
        ) : null}

        {tab === "links" ? (
          <>
            <section className="grid gap-4" aria-labelledby="placements-heading">
              <RevealPanels
                heading={
                  <>
                    <h2 id="placements-heading" className="panel-title">
                      Labelled links
                    </h2>
                    <p className="mt-1 max-w-2xl text-sm text-muted">
                      Extra short links to the same destination, each with{" "}
                      <a href={`/workspaces/${ownership.workspaceId}/parameters`} className="text-teal hover:underline">
                        {ownership.workspaceName} labels
                      </a>{" "}
                      such as store or channel, and its own QR code. Their visits also count in the overview.
                    </p>
                  </>
                }
                panels={
                  canPlace
                    ? [
                        {
                          key: "add",
                          label: "Add labelled link",
                          primary: true,
                          content: (
                            <div className="panel">
                              <h3 className="sub-title mb-3">Add a labelled link</h3>
                              <PlacementForm
                                slug={detail.link.slug}
                                fields={fields}
                                base={base}
                                manageHref={`/workspaces/${ownership.workspaceId}/parameters`}
                              />
                            </div>
                          ),
                        },
                        {
                          key: "csv",
                          label: "Import CSV",
                          content: (
                            <div className="panel">
                              <h3 className="sub-title mb-3">Add many from a spreadsheet (CSV)</h3>
                              <BulkPlacementForm slug={detail.link.slug} columns={["name", ...fields.map((f) => f.key)]} />
                            </div>
                          ),
                        },
                      ]
                    : []
                }
                defaultOpen={canPlace && placementCount === 0 ? "add" : null}
              />

              {bulkJobs.length > 0 ? (
                <div className="panel">
                  <AutoRefresh active={bulkRunning} />
                  <h3 className="sub-title mb-3">QR code downloads</h3>
                  {stalled ? (
                    <p className="mb-3 rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn" role="alert">
                      {inline ? (
                        <>
                          A batch stopped before finishing, probably at the server&apos;s time limit. Try fewer rows or
                          SVG files.
                        </>
                      ) : (
                        <>
                          A batch has been waiting for over two minutes. The background worker may not be running;
                          start it with <span className="font-mono">npm run worker</span>.
                        </>
                      )}
                    </p>
                  ) : null}
                  <ul className="grid gap-2">
                    {bulkJobs.map((job) => (
                      <li
                        key={job.id}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="font-medium">
                            {job.total.toLocaleString("en")} QR code{job.total === 1 ? "" : "s"} ·{" "}
                            {job.format.toUpperCase()}
                          </p>
                          <p className="text-xs text-muted">
                            <LocalTime iso={job.createdAt} />
                            {job.status === "failed" && job.error ? ` · ${job.error}` : ""}
                          </p>
                        </div>
                        {job.status === "done" ? (
                          job.hasZip ? (
                            <a href={`/stats/${detail.link.slug}/bulk/${job.id}`} className="btn-primary text-sm no-underline">
                              Download zip
                            </a>
                          ) : (
                            <span className="text-muted">Zip expired · the labelled links are listed below</span>
                          )
                        ) : job.status === "failed" ? (
                          <span className="text-warn">Failed</span>
                        ) : (
                          <span className="num text-muted" role="status">
                            {job.status === "queued"
                              ? "Waiting…"
                              : `Making QR codes ${job.processed.toLocaleString("en")} / ${job.total.toLocaleString("en")}`}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}

              {placementCount > 0 ? (
                <ListFilters
                  action={`/stats/${detail.link.slug}`}
                  keep={{ tab: "links" }}
                  search={{ value: linkFilters.q, placeholder: "Search code or label value", label: "Search labelled links" }}
                  filters={[
                    {
                      name: "status",
                      label: "Status",
                      defaultValue: "all",
                      value: linkFilters.status,
                      options: [
                        { value: "all", label: "All statuses" },
                        { value: "active", label: "Active" },
                        { value: "inactive", label: "Inactive" },
                      ],
                    },
                  ]}
                />
              ) : null}

              {placementCount === 0 ? (
                <p className="empty-state text-sm">No labelled links yet.</p>
              ) : !linksPage || linksPage.rows.length === 0 ? (
                <p className="empty-state text-sm">
                  {linksPage && linksPage.total > 0 ? (
                    <>
                      Nothing on this page. <a href={linksPageHref(1)} className="text-teal hover:underline">Go to page 1</a>
                    </>
                  ) : (
                    "No labelled links match."
                  )}
                </p>
              ) : (
                <ul className="grid gap-3">
                  {linksPage.rows.map((p) => {
                    const url = `${base}/q/${p.code}`;
                    // Named from its labels when it has no name of its own (the forms no longer ask for one).
                    const title = p.name || p.values.map((v) => v.value).join(" · ") || p.code;
                    return (
                      <li
                        key={p.id}
                        className={`grid gap-3 rounded-xl border border-line px-4 py-3 md:grid-cols-[1fr_auto] md:items-center ${
                          p.isActive ? "bg-card" : "bg-paper text-muted"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-semibold">{title}</span>
                            {p.legacyTag ? (
                              <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">
                                from tag <span className="font-mono">{p.legacyTag}</span>
                              </span>
                            ) : null}
                            {p.isActive ? null : (
                              <span className="rounded-full border border-line px-2 py-0.5 text-xs">Inactive · still redirects</span>
                            )}
                          </p>
                          <p className="mt-1 truncate font-mono text-sm text-teal">{url}</p>
                          {p.values.length > 0 ? (
                            <ul className="mt-2 flex flex-wrap gap-2">
                              {p.values.map((v) => (
                                <li key={v.parameterId} className="rounded-full border border-line bg-paper px-3 py-1 text-xs">
                                  <span className="text-muted">{v.name}:</span>{" "}
                                  <span className="font-mono">{v.value}</span>
                                  {v.label ? <span className="text-muted"> · {v.label}</span> : null}
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm md:justify-end">
                          <p>
                            <span className="num font-semibold">{p.clicks}</span> <span className="text-muted">clicks</span>
                          </p>
                          <p>
                            <span className="num">{p.visitors}</span> <span className="text-muted">visitors</span>
                          </p>
                          <CopyButton value={url} />
                          <QrButton slug={detail.link.slug} placement={p.code} label={title} url={url} />
                          {canPlace ? (
                            <ActionForm
                              action={setPlacementStatus}
                              submit={p.isActive ? "Deactivate" : "Activate"}
                              variant={p.isActive ? "danger" : "secondary"}
                              confirm={
                                p.isActive
                                  ? `Deactivate ${title}? Its code keeps redirecting and counting scans, since it may be printed.`
                                  : undefined
                              }
                              quiet
                              inline
                            >
                              <input type="hidden" name="placement_id" value={p.id} />
                              <input type="hidden" name="is_active" value={p.isActive ? "false" : "true"} />
                            </ActionForm>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
              {linksPage ? (
                <Pagination
                  page={linkFilters.page}
                  pageSize={LINKS_PAGE_SIZE}
                  total={linksPage.total}
                  href={linksPageHref}
                  noun="labelled links"
                />
              ) : null}
            </section>

            {/* Tags are no longer added; links that have them keep working and stay listed here. */}
            {detail.tag_stats.length > 0 ? (
              <section className="grid gap-3">
                <div>
                  <h2 className="sub-title">Older tag links</h2>
                  <p className="mt-1 text-sm text-muted">
                    These links keep working. For a new channel, add a labelled link with a label such as Channel.
                  </p>
                </div>
                <ul className="grid gap-3">
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
              </section>
            ) : null}
          </>
        ) : null}

        {tab === "settings" ? (
          <>
            {detail.link.kind === "page" || (target && isOwner) ? (
              <section className="panel grid gap-5">
                <div>
                  <h2 className="panel-title">Destination</h2>
                  <p className="mt-1 text-sm text-muted">Where the short link and all its labelled links send people.</p>
                </div>
                {detail.link.kind === "page" ? (
                  <PagePreview
                    key={pageVersion}
                    src={`/stats/${detail.link.slug}/preview?v=${pageVersion}`}
                    title={`Preview of ${detail.link.slug}`}
                  />
                ) : null}
                {target && isOwner ? (
                  <EditTargetForm slug={detail.link.slug} kind={target.kind} url={target.url} html={target.html} />
                ) : null}
              </section>
            ) : null}

            {moveTargets.length > 0 ? (
              <section className="danger-zone">
                <h2 className="sub-title text-warn">Move to another workspace</h2>
                <p className="mt-1 text-sm text-muted">
                  The short link, tags, and visit history stay the same. Only who can see and manage it changes.
                </p>
                <ActionForm
                  action={moveLinkToWorkspace}
                  submit="Move link"
                  pending="Moving…"
                  variant="danger"
                  confirm="Move this link? People in the current workspace may lose access to it."
                  className="mt-4 grid gap-3"
                >
                  <input type="hidden" name="slug" value={detail.link.slug} />
                  <FormSelect
                    name="workspace_id"
                    required
                    options={moveTargets.map((w) => ({ value: w.id, label: w.name }))}
                    placeholder="Choose a workspace"
                    ariaLabel="Workspace"
                  />
                </ActionForm>
              </section>
            ) : null}
          </>
        ) : null}
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
