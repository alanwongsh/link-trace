import { CreateLinkForm, type WritableWorkspace } from "@/components/create-link-form";
import { CopyButton } from "@/components/copy-button";
import { QrButton } from "@/components/qr-button";
import { DeleteLinkButton } from "@/components/delete-link-button";
import { LinkTarget } from "@/components/link-target";
import { SetupGuide } from "@/components/setup-guide";
import { TopBar } from "@/components/top-bar";
import { WorkspaceFilter } from "@/components/workspace-filter";
import { listWorkspaces } from "@/lib/accounts";
import { can, requireUser, roleIn } from "@/lib/auth";
import { listLinks } from "@/lib/data";
import { appOrigin } from "@/lib/origin";
import { atLeast } from "@/lib/roles";
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

  const result = await listLinks({
    workspaceIds: current !== "all" ? [current] : user.isOrgAdmin ? "all" : visible.map((w) => w.id),
    createdBy: mine ? user.id : undefined,
  });
  const base = await appOrigin();
  const links = result.ok ? result.data : [];
  const visits = links.reduce((sum, link) => sum + link.click_count, 0);
  const meta = result.ok
    ? `${links.length} ${links.length === 1 ? "link" : "links"} · ${visits} visits`
    : undefined;

  const writable: WritableWorkspace[] = visible
    .map((w) => ({ ...w, role: roleIn(user, w.id) }))
    .filter((w): w is WritableWorkspace => atLeast(w.role, "editor"));
  const defaultWorkspaceId = writable.some((w) => w.id === current) ? current : writable[0]?.id;
  const showWorkspace = current === "all" && visible.length > 1;

  return (
    <>
      <TopBar meta={meta} />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="max-w-2xl">
          <h1 className="font-serif text-4xl tracking-tight">Make a short link</h1>
          <p className="mt-2 text-muted">
            Each open stores the IP address, a first-party visitor id, browser, referrer,
            and — on Vercel — country and city. Add platform tags to give each channel its own
            link. Counts below skip known bots.
          </p>
        </div>
        {!result.ok ? (
          result.missingConfig || result.missingSchema ? (
            <SetupGuide message={result.message} />
          ) : (
            <p className="text-sm text-warn">{result.message}</p>
          )
        ) : visible.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-muted">
            You are not in any workspace yet, so there are no links to show. Ask an org admin to add you.
          </p>
        ) : defaultWorkspaceId ? (
          <CreateLinkForm workspaces={writable} defaultWorkspaceId={defaultWorkspaceId} />
        ) : (
          <p className="text-sm text-muted">
            You can view links but not create them. Ask an org admin for the editor role.
          </p>
        )}
        {result.ok && visible.length > 0 ? (
          <section className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-serif text-2xl">Links</h2>
              <WorkspaceFilter
                workspaces={filterOptions}
                current={current}
                mine={mine}
              />
            </div>
            {links.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-line px-5 py-8 text-muted">
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
                      <span className="num text-lg">{link.click_count}</span>{" "}
                      <span className="text-muted">clicks</span>
                    </p>
                    <p className="text-sm">
                      <span className="num text-lg">{link.visitor_count}</span>{" "}
                      <span className="text-muted">visitors</span>
                    </p>
                    <p className="text-sm text-muted">
                      <LocalTime iso={link.created_at} withTime={false} />
                    </p>
                    <CopyButton value={shortUrl} />
                    <QrButton slug={link.slug} url={shortUrl} />
                    {can(user, link.workspace_id, "owner") ? <DeleteLinkButton slug={link.slug} /> : null}
                  </div>
                </article>
              );
            })}
          </section>
        ) : null}
      </main>
    </>
  );
}
