import { Breakdown, DailyBars, Stat } from "@/components/charts";
import { CreateLinkForm, type WritableWorkspace } from "@/components/create-link-form";
import { CopyButton } from "@/components/copy-button";
import { QrButton } from "@/components/qr-button";
import { RevealPanels } from "@/components/reveal-panels";
import { DeleteLinkButton } from "@/components/delete-link-button";
import { LinkTarget } from "@/components/link-target";
import { SetupGuide } from "@/components/setup-guide";
import { TopBar } from "@/components/top-bar";
import { WorkspaceFilter } from "@/components/workspace-filter";
import { listWorkspaces } from "@/lib/accounts";
import { allowed, can, requireUser, roleIn } from "@/lib/auth";
import { listLinks, loadDashboard } from "@/lib/data";
import { placementFields } from "@/lib/parameter-data";
import { appOrigin } from "@/lib/origin";
import { atLeast } from "@/lib/roles";
import { countryName } from "@/lib/track";
import { LocalTime } from "@/components/local-time";

export const dynamic = "force-dynamic";

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ ws?: string; mine?: string }>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  // Org admins see every workspace; everyone else sees their memberships.
  const visible = user.isOrgAdmin
    ? (await listWorkspaces()).map((w) => ({ id: w.id, name: w.name }))
    : user.memberships.map((m) => ({ id: m.workspaceId, name: m.workspaceName }));
  // "all" is a sentinel for the filter only; it is not a real workspace id.
  const filterOptions = [{ id: "all", name: "All workspaces" }, ...visible];

  const current = params.ws && visible.some((w) => w.id === params.ws) ? params.ws : "all";
  const mine = params.mine === "1";

  const filter = {
    workspaceIds: current !== "all" ? [current] : user.isOrgAdmin ? ("all" as const) : visible.map((w) => w.id),
    createdBy: mine ? user.id : undefined,
  };
  const [result, dashboard] = await Promise.all([listLinks(filter), loadDashboard(filter)]);
  const summary = dashboard.ok ? dashboard.data : null;
  const base = await appOrigin();
  const links = result.ok ? result.data : [];
  const visits = links.reduce((sum, link) => sum + link.click_count, 0);
  const meta = result.ok
    ? `${links.length} ${links.length === 1 ? "link" : "links"} · ${visits} visits`
    : undefined;

  const editable = visible
    .map((w) => ({ ...w, role: roleIn(user, w.id) }))
    .filter((w): w is typeof w & { role: NonNullable<typeof w.role> } => atLeast(w.role, "editor"));
  // Parameters for the optional first placement, only where the user may add placements.
  const writable: WritableWorkspace[] = await Promise.all(
    editable.map(async (w) => {
      const canPlace = allowed(user, w.id, "placements.manage");
      return { ...w, canPlace, fields: canPlace && result.ok ? await placementFields(w.id) : [] };
    }),
  );
  const defaultWorkspaceId = writable.some((w) => w.id === current) ? current : writable[0]?.id;
  const showWorkspace = current === "all" && visible.length > 1;

  const ready = result.ok && visible.length > 0;

  return (
    <>
      <TopBar meta={meta} />
      <main className="mx-auto grid max-w-5xl gap-10 px-6 py-10">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <h1 className="font-serif text-4xl tracking-tight">Dashboard</h1>
            <p className="mt-2 text-muted">
              Your short links and how often people open them. Known bots are left out of the counts.
            </p>
          </div>
          {ready ? <WorkspaceFilter workspaces={filterOptions} current={current} mine={mine} /> : null}
        </div>

        {!result.ok ? (
          result.missingConfig || result.missingSchema ? (
            <SetupGuide message={result.message} />
          ) : (
            <p className="text-sm text-warn">{result.message}</p>
          )
        ) : visible.length === 0 ? (
          <p className="empty-state">
            You are not in any workspace yet, so there are no links to show. Ask an org admin to add you.
          </p>
        ) : null}

        {ready && summary ? (
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Totals">
            <Stat label="Links" value={links.length} hint={mine ? "Created by you" : "In this view"} />
            <Stat label="Clicks" value={summary.clicks} hint={`${summary.clicks7d.toLocaleString("en")} in the last 7 days`} />
            <Stat label="Visitors" value={summary.visitors} hint="Estimated from browser ids" />
            <Stat
              label="Today"
              value={summary.clicksToday}
              hint={`${summary.botClicks.toLocaleString("en")} bot hits left out`}
            />
          </section>
        ) : ready && !dashboard.ok ? (
          <p className="text-sm text-warn">{dashboard.message}</p>
        ) : null}

        {ready ? (
          <section className="grid gap-3" aria-labelledby="links-heading">
            <RevealPanels
              heading={
                <>
                  <h2 id="links-heading" className="panel-title">
                    Links <span className="num text-base text-muted">{links.length}</span>
                  </h2>
                  {defaultWorkspaceId ? null : (
                    <p className="mt-1 text-sm text-muted">
                      You can view links but not create them. Ask an org admin for the editor role.
                    </p>
                  )}
                </>
              }
              panels={
                defaultWorkspaceId
                  ? [
                      {
                        key: "new-link",
                        label: "New link",
                        primary: true,
                        content: <CreateLinkForm workspaces={writable} defaultWorkspaceId={defaultWorkspaceId} />,
                      },
                    ]
                  : []
              }
              defaultOpen={defaultWorkspaceId && links.length === 0 && !mine ? "new-link" : null}
            />
            {links.length === 0 ? (
              <p className="empty-state">
                {mine ? "You have not created any links here yet." : "No links yet. Create one, then share the /r/ address."}
              </p>
            ) : null}
            {links.map((link) => {
              const shortUrl = `${base}/r/${link.slug}`;
              return (
                <article
                  key={link.id}
                  className="grid gap-4 rounded-2xl border border-line bg-card px-5 py-4 md:grid-cols-[1fr_auto] md:items-center"
                >
                  <div className="min-w-0">
                    <a
                      href={`/stats/${link.slug}`}
                      className="block truncate text-lg font-bold tracking-tight hover:text-teal"
                    >
                      {link.title || link.slug}
                    </a>
                    <p className="mt-1 truncate font-mono text-sm text-teal">{shortUrl}</p>
                    <LinkTarget slug={link.slug} kind={link.kind} url={link.url} />
                    <p className="mt-1 truncate text-xs text-muted">
                      {showWorkspace ? `${link.workspace_name} · ` : ""}
                      {link.created_by_name ? `by ${link.created_by_name}` : "Created before sign-in existed"}
                      {" · "}
                      <LocalTime iso={link.created_at} withTime={false} />
                    </p>
                    {link.tags.length > 0 ? (
                      <ul className="mt-3 flex flex-wrap gap-2">
                        {link.tags.map((tag) => (
                          <li
                            key={tag}
                            className="flex items-center gap-2 rounded-full border border-line bg-paper px-3 py-1"
                          >
                            <span className="font-mono text-xs">{tag}</span>
                            <CopyButton value={`${shortUrl}/${tag}`} />
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-5 gap-y-2 md:justify-end">
                    <p className="text-sm">
                      <span className="num text-lg font-semibold">{link.click_count}</span>{" "}
                      <span className="text-muted">clicks</span>
                    </p>
                    <p className="text-sm">
                      <span className="num text-lg">{link.visitor_count}</span>{" "}
                      <span className="text-muted">visitors</span>
                    </p>
                    <div className="flex items-center gap-2">
                      <CopyButton value={shortUrl} />
                      <QrButton slug={link.slug} url={shortUrl} />
                    </div>
                    {can(user, link.workspace_id, "owner") ? <DeleteLinkButton slug={link.slug} /> : null}
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}

        {ready && summary ? (
          <section className="grid gap-4" aria-labelledby="activity-heading">
            <h2 id="activity-heading" className="panel-title">
              Activity
            </h2>
            <div className="panel">
              <h3 className="sub-title">Last 30 days</h3>
              <p className="mt-1 text-sm text-muted">Human visits per day, grouped in UTC. Hover a bar for its count.</p>
              <DailyBars days={summary.daily} label="Human visits per day, last 30 days" />
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              <Breakdown
                title="Top links"
                empty="No links yet."
                rows={[...links]
                  .filter((link) => link.click_count > 0)
                  .sort((a, b) => b.click_count - a.click_count)
                  .slice(0, 6)
                  .map((link) => ({ label: link.title || link.slug, clicks: link.click_count, href: `/stats/${link.slug}` }))}
              />
              {/* Only while older tag links still get visits; new channels use labelled links. */}
              {summary.tags.some((row) => row.tag) ? (
                <Breakdown
                  title="Older tag links"
                  rows={summary.tags.map((row) => ({ label: row.tag || "Untagged", clicks: row.clicks }))}
                />
              ) : null}
              <Breakdown
                title="Places"
                rows={summary.countries.map((row) => ({
                  label: row.country === "Unknown" ? "No location" : countryName(row.country),
                  clicks: row.clicks,
                }))}
              />
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
