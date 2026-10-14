import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AdminNav } from "@/components/admin-nav";
import { RoleSelect } from "@/components/role-select";
import { TopBar } from "@/components/top-bar";
import { findWorkspace, listWorkspaces, workspaceMembers } from "@/lib/accounts";
import { addMember, removeMember, removeWorkspace, updateWorkspaceName } from "@/lib/admin-actions";
import { requireOrgAdmin } from "@/lib/auth";
import { ROLE_LABELS, ROLE_NAMES } from "@/lib/roles";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function WorkspacePage({ params }: { params: Promise<{ id: string }> }) {
  await requireOrgAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const workspace = await findWorkspace(id);
  if (!workspace) notFound();
  const [members, all] = await Promise.all([workspaceMembers(id), listWorkspaces()]);
  const linkCount = all.find((w) => w.id === id)?.linkCount ?? 0;

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-4">
          <a href="/admin/workspaces" className="text-sm text-teal">
            All workspaces
          </a>
          <div>
            <h1 className="font-serif text-4xl tracking-tight">{workspace.name}</h1>
            <p className="mt-2 text-muted">
              {members.length} {members.length === 1 ? "member" : "members"} · {linkCount}{" "}
              {linkCount === 1 ? "link" : "links"} ·{" "}
              <a href={`/?ws=${workspace.id}`} className="text-teal hover:underline">
                View links
              </a>
            </p>
          </div>
          <AdminNav current="/admin/workspaces" />
        </div>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Members</h2>
          <ul className="mt-2 grid gap-1 text-sm text-muted">
            {ROLE_NAMES.map((role) => (
              <li key={role}>{ROLE_LABELS[role]}</li>
            ))}
          </ul>
          {members.length === 0 ? (
            <p className="mt-4 text-sm text-muted">No members yet. Org admins can still manage it.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {members.map((m) => (
                <li
                  key={m.userId}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3"
                >
                  <a href={`/admin/users/${m.userId}`} className="min-w-0 hover:text-teal">
                    <span className="block truncate font-medium">
                      {m.name}
                      {m.status === "disabled" ? <span className="ml-2 text-xs text-warn">Disabled</span> : null}
                    </span>
                    <span className="block truncate text-sm text-muted">{m.email}</span>
                  </a>
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionForm action={addMember} submit="Save role" variant="secondary" inline>
                      <input type="hidden" name="workspace_id" value={workspace.id} />
                      <input type="hidden" name="user_id" value={m.userId} />
                      <RoleSelect defaultValue={m.role} />
                    </ActionForm>
                    <ActionForm
                      action={removeMember}
                      submit="Remove"
                      pending="Removing…"
                      variant="danger"
                      confirm={`Remove ${m.name} from ${workspace.name}?`}
                      inline
                    >
                      <input type="hidden" name="workspace_id" value={workspace.id} />
                      <input type="hidden" name="user_id" value={m.userId} />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <ActionForm action={addMember} submit="Add member" pending="Adding…" className="mt-4 grid gap-3">
            <input type="hidden" name="workspace_id" value={workspace.id} />
            <div className="flex flex-wrap gap-2">
              <input
                name="email"
                type="email"
                required
                placeholder="Email of an existing user"
                className="field w-auto min-w-64 flex-1"
                aria-label="Email"
              />
              <RoleSelect defaultValue="editor" />
            </div>
          </ActionForm>
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Name</h2>
          <ActionForm action={updateWorkspaceName} submit="Save" className="mt-4 grid max-w-md gap-3">
            <input type="hidden" name="workspace_id" value={workspace.id} />
            <input
              name="name"
              defaultValue={workspace.name}
              maxLength={60}
              required
              className="field"
              aria-label="Workspace name"
            />
          </ActionForm>
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Delete workspace</h2>
          <p className="mt-1 text-sm text-muted">
            Only possible once it has no links. Move them to another workspace from each link&apos;s page first.
          </p>
          <div className="mt-4">
            <ActionForm
              action={removeWorkspace}
              submit="Delete workspace"
              pending="Deleting…"
              variant="danger"
              confirm={`Delete ${workspace.name}? Its member list is removed too.`}
              inline
            >
              <input type="hidden" name="workspace_id" value={workspace.id} />
            </ActionForm>
          </div>
        </section>
      </main>
    </>
  );
}
