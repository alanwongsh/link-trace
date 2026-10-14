import { ActionForm } from "@/components/action-form";
import { AdminNav } from "@/components/admin-nav";
import { TopBar } from "@/components/top-bar";
import { listWorkspaces } from "@/lib/accounts";
import { createWorkspace } from "@/lib/admin-actions";
import { requireOrgAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function WorkspacesPage() {
  await requireOrgAdmin();
  const workspaces = await listWorkspaces();

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-4">
          <h1 className="font-serif text-4xl tracking-tight">Workspaces</h1>
          <AdminNav current="/admin/workspaces" />
          <p className="max-w-2xl text-muted">
            A workspace is a team that owns links, such as Marketing – Digital or a campaign task force.
            People see only the links in their workspaces. One person can be in several.
          </p>
        </div>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">New workspace</h2>
          <ActionForm
            action={createWorkspace}
            submit="Create workspace"
            pending="Creating…"
            className="mt-4 grid max-w-md gap-3"
          >
            <input
              name="name"
              maxLength={60}
              required
              placeholder="Marketing – Digital"
              className="field"
              aria-label="Workspace name"
            />
          </ActionForm>
        </section>

        <section className="grid gap-2">
          {workspaces.map((w) => (
            <a
              key={w.id}
              href={`/admin/workspaces/${w.id}`}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-card px-4 py-3 transition hover:border-teal"
            >
              <span className="font-medium">{w.name}</span>
              <span className="text-sm text-muted">
                {w.memberCount} {w.memberCount === 1 ? "member" : "members"} · {w.linkCount}{" "}
                {w.linkCount === 1 ? "link" : "links"}
              </span>
            </a>
          ))}
        </section>
      </main>
    </>
  );
}
