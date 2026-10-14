import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { AdminNav } from "@/components/admin-nav";
import { LocalTime } from "@/components/local-time";
import { RoleSelect } from "@/components/role-select";
import { TopBar } from "@/components/top-bar";
import { findUserById, listWorkspaces, membershipsFor } from "@/lib/accounts";
import {
  addMember,
  removeMember,
  renameUser,
  resetPassword,
  setOrgAdmin,
  setUserStatus,
} from "@/lib/admin-actions";
import { requireOrgAdmin } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function UserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireOrgAdmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const user = await findUserById(id);
  if (!user) notFound();
  const [memberships, workspaces] = await Promise.all([membershipsFor(id), listWorkspaces()]);
  const joinable = workspaces.filter((w) => !memberships.some((m) => m.workspaceId === w.id));
  const self = admin.id === user.id;

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-4">
          <a href="/admin/users" className="text-sm text-teal">All users</a>
          <div>
            <h1 className="font-serif text-4xl tracking-tight">{user.name}</h1>
            <p className="mt-2 text-muted">
              {user.email}
              {user.isOrgAdmin ? " · Org admin" : ""}
              {user.status === "disabled" ? " · Disabled" : ""}
              {" · "}
              {user.lastLoginAt ? (
                <>last sign-in <LocalTime iso={user.lastLoginAt} /></>
              ) : (
                "never signed in"
              )}
            </p>
          </div>
          <AdminNav current="/admin/users" />
        </div>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Workspaces</h2>
          {user.isOrgAdmin ? (
            <p className="mt-1 text-sm text-muted">Org admins can already see and manage every workspace.</p>
          ) : null}
          {memberships.length === 0 ? (
            <p className="mt-3 text-sm text-muted">Not in any workspace yet, so they see no links.</p>
          ) : (
            <ul className="mt-4 grid gap-2">
              {memberships.map((m) => (
                <li key={m.workspaceId} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line px-4 py-3">
                  <a href={`/admin/workspaces/${m.workspaceId}`} className="font-medium hover:text-teal">
                    {m.workspaceName}
                  </a>
                  <div className="flex flex-wrap items-center gap-2">
                    <ActionForm action={addMember} submit="Save role" variant="secondary" inline>
                      <input type="hidden" name="workspace_id" value={m.workspaceId} />
                      <input type="hidden" name="user_id" value={user.id} />
                      <RoleSelect defaultValue={m.role} />
                    </ActionForm>
                    <ActionForm
                      action={removeMember}
                      submit="Remove"
                      pending="Removing…"
                      variant="danger"
                      confirm={`Remove ${user.name} from ${m.workspaceName}?`}
                      inline
                    >
                      <input type="hidden" name="workspace_id" value={m.workspaceId} />
                      <input type="hidden" name="user_id" value={user.id} />
                    </ActionForm>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {joinable.length > 0 ? (
            <ActionForm action={addMember} submit="Add to workspace" pending="Adding…" className="mt-4 grid gap-3">
              <input type="hidden" name="user_id" value={user.id} />
              <div className="flex flex-wrap gap-2">
                <select name="workspace_id" required className="field w-auto min-w-48" defaultValue="">
                  <option value="" disabled>Choose a workspace</option>
                  {joinable.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
                <RoleSelect defaultValue="editor" />
              </div>
            </ActionForm>
          ) : null}
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Name</h2>
          <ActionForm action={renameUser} submit="Save" className="mt-4 grid max-w-md gap-3">
            <input type="hidden" name="user_id" value={user.id} />
            <input name="name" defaultValue={user.name} maxLength={80} required className="field" aria-label="Name" />
          </ActionForm>
        </section>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Reset password</h2>
          <p className="mt-1 text-sm text-muted">
            Sets a temporary password, signs them out everywhere, and unlocks the account. Tell them the
            new password yourself.
          </p>
          <ActionForm action={resetPassword} submit="Set temporary password" className="mt-4 grid max-w-md gap-3">
            <input type="hidden" name="user_id" value={user.id} />
            <input
              name="password"
              type="text"
              autoComplete="off"
              minLength={MIN_PASSWORD_LENGTH}
              required
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              className="field font-mono"
              aria-label="Temporary password"
            />
          </ActionForm>
        </section>

        {!self ? (
          <section className="grid gap-4 rounded-2xl border border-line bg-card p-5">
            <h2 className="font-serif text-2xl">Access</h2>
            <ActionForm
              action={setOrgAdmin}
              submit={user.isOrgAdmin ? "Remove org admin" : "Make org admin"}
              variant="secondary"
              confirm={
                user.isOrgAdmin
                  ? `Remove org admin from ${user.name}?`
                  : `Make ${user.name} an org admin? They will manage all users and workspaces.`
              }
              inline
            >
              <input type="hidden" name="user_id" value={user.id} />
              <input type="hidden" name="is_org_admin" value={user.isOrgAdmin ? "false" : "true"} />
            </ActionForm>
            <ActionForm
              action={setUserStatus}
              submit={user.status === "active" ? "Disable account" : "Enable account"}
              variant={user.status === "active" ? "danger" : "secondary"}
              confirm={
                user.status === "active"
                  ? `Disable ${user.name}? They are signed out at once and cannot sign in.`
                  : undefined
              }
              inline
            >
              <input type="hidden" name="user_id" value={user.id} />
              <input type="hidden" name="status" value={user.status === "active" ? "disabled" : "active"} />
            </ActionForm>
          </section>
        ) : null}
      </main>
    </>
  );
}
