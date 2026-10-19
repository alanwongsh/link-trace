import { createHash } from "node:crypto";
import { FormSelect } from "@/components/form-select";
import { Breakdown, DailyBars, Stat } from "@/components/charts";
import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AddTagsForm } from "@/components/add-tags-form";
import { CopyButton } from "@/components/copy-button";
import { EditTargetForm } from "@/components/edit-target-form";
import { LinkTarget } from "@/components/link-target";
import { LocalTime } from "@/components/local-time";
import { PagePreview } from "@/components/page-preview";
import { PlacementForm } from "@/components/placement-form";
import { AutoRefresh } from "@/components/auto-refresh";
import { BulkPlacementForm } from "@/components/bulk-placement-form";
import { QrButton } from "@/components/qr-button";
import { VisitorMap } from "@/components/visitor-map";
import { SetupGuide } from "@/components/setup-guide";
import { TopBar } from "@/components/top-bar";
import { listWorkspaces } from "@/lib/accounts";
import { moveLinkToWorkspace } from "@/lib/actions";
import { allowed, can, requireUser } from "@/lib/auth";
import { findDestination, linkOwnership, loadDetail } from "@/lib/data";
import { placementFields } from "@/lib/parameter-data";
import { setPlacementStatus } from "@/lib/placement-actions";
import { listPlacements } from "@/lib/placement-data";
import { listBulkJobs } from "@/lib/bulk-data";
import { jobsRunInline } from "@/lib/queue";
import { appOrigin } from "@/lib/origin";
import {
  browserLabel,
  countryName,
  ipLabel,
  isLoopback,
  placeLabel,
} from "@/lib/track";

export const dynamic = "force-dynamic";
// Bulk uploads run after this page's actions respond; Vercel caps this at the plan's limit.
export const maxDuration = 300;

export default async function StatsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const user = await requireUser();
  const { slug } = await params;
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
  // Links outside the user's workspaces look the same as missing ones.
  const ownership = await linkOwnership(detail.link.slug);
  if (!ownership || !can(user, ownership.workspaceId, "viewer")) notFound();
  const canEdit = can(user, ownership.workspaceId, "editor");
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
  const [placementRows, fields, bulkJobs] = await Promise.all([
    listPlacements(detail.link.id),
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

  return (
    <>
      <TopBar meta={`${detail.unique_visitors} visitors`} />
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

        {detail.link.kind === "page" ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <PagePreview
              key={pageVersion}
              src={`/stats/${detail.link.slug}/preview?v=${pageVersion}`}
              title={`Preview of ${detail.link.slug}`}
            />
          </section>
        ) : null}

        {target && isOwner ? (
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
          {canEdit ? <AddTagsForm slug={detail.link.slug} /> : null}
        </section>

        <section id="placements" className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Placements</h2>
          <p className="mt-1 text-sm text-muted">
            Each placement is one real QR code or printed spot, with its own short address and the labels set in{" "}
            <a href={`/workspaces/${ownership.workspaceId}/parameters`} className="text-teal hover:underline">
              {ownership.workspaceName} parameters
            </a>
            . Scans of a placement also count in the totals above.
          </p>
          {placementRows.length === 0 ? (
            <p className="empty-state mt-4 text-sm">No placements yet.</p>
          ) : (
            <ul className="mt-4 grid gap-3">
              {placementRows.map((p) => {
                const url = `${base}/q/${p.code}`;
                const title = p.name || p.code;
                return (
                  <li
                    key={p.id}
                    className={`grid gap-3 rounded-xl border border-line px-4 py-3 md:grid-cols-[1fr_auto] md:items-center ${
                      p.isActive ? "" : "bg-paper text-muted"
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
                        <span className="num">{p.clicks}</span> <span className="text-muted">clicks</span>
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
          {canPlace ? (
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="mb-3 text-lg font-semibold">Add a placement</h3>
              <PlacementForm
                slug={detail.link.slug}
                fields={fields}
                base={base}
                manageHref={`/workspaces/${ownership.workspaceId}/parameters`}
              />
            </div>
          ) : null}
          {canPlace ? (
            <div className="mt-5 border-t border-line pt-5">
              <h3 className="mb-3 text-lg font-semibold">Add many from CSV</h3>
              <BulkPlacementForm slug={detail.link.slug} columns={["name", ...fields.map((f) => f.key)]} />
            </div>
          ) : null}
          {bulkJobs.length > 0 ? (
            <div className="mt-5 border-t border-line pt-5">
              <AutoRefresh active={bulkRunning} />
              <h3 className="mb-3 text-lg font-semibold">Bulk uploads</h3>
              {stalled ? (
                <p className="mb-3 rounded-xl border border-warn/40 bg-warn/5 px-4 py-3 text-sm text-warn" role="alert">
                  {inline ? (
                    <>
                      An upload stopped before finishing, probably at the server&apos;s time limit. Try fewer rows or SVG
                      files.
                    </>
                  ) : (
                    <>
                      An upload has been waiting for over two minutes. The background worker may not be running; start
                      it with <span className="font-mono">npm run worker</span>.
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
                        {job.total.toLocaleString("en")} placement{job.total === 1 ? "" : "s"} ·{" "}
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
                        <span className="text-muted">Zip expired · the placements are listed above</span>
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
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Last 14 days</h2>
          <p className="mt-1 text-sm text-muted">Human visits only. Days are grouped in UTC.</p>
          <DailyBars days={detail.daily} label="Human visits per day, last 14 days" />
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
            <p className="empty-state">
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
        {moveTargets.length > 0 ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-serif text-2xl">Move to another workspace</h2>
            <p className="mt-1 text-sm text-muted">
              The short link, tags, and visit history stay the same. Only who can see and manage it changes.
            </p>
            <ActionForm action={moveLinkToWorkspace} submit="Move link" pending="Moving…" variant="secondary" className="mt-4 grid gap-3">
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
