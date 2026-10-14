import { ActionForm } from "@/components/action-form";
import { AdminNav } from "@/components/admin-nav";
import { LocalTime } from "@/components/local-time";
import { TopBar } from "@/components/top-bar";
import { listUsers } from "@/lib/accounts";
import { createUser } from "@/lib/admin-actions";
import { requireOrgAdmin } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  await requireOrgAdmin();
  const users = await listUsers();

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-5xl gap-8 px-6 py-10">
        <div className="grid gap-4">
          <h1 className="font-serif text-4xl tracking-tight">Users</h1>
          <AdminNav current="/admin/users" />
        </div>

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Add a user</h2>
          <p className="mt-1 text-sm text-muted">
            Give them the temporary password yourself. They must change it the first time they sign in.
          </p>
          <ActionForm action={createUser} submit="Add user" pending="Adding…" className="mt-4 grid gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-2">
                <label htmlFor="name" className="text-sm font-medium">Name</label>
                <input id="name" name="name" maxLength={80} required className="field" />
              </div>
              <div className="grid gap-2">
                <label htmlFor="email" className="text-sm font-medium">Work email</label>
                <input id="email" name="email" type="email" required className="field" />
              </div>
              <div className="grid gap-2">
                <label htmlFor="password" className="text-sm font-medium">
                  Temporary password <span className="font-normal text-muted">at least {MIN_PASSWORD_LENGTH} characters</span>
                </label>
                <input
                  id="password"
                  name="password"
                  type="text"
                  autoComplete="off"
                  minLength={MIN_PASSWORD_LENGTH}
                  required
                  className="field font-mono"
                />
              </div>
              <label className="flex items-center gap-2 self-end pb-3 text-sm">
                <input type="checkbox" name="is_org_admin" /> Org admin
              </label>
            </div>
          </ActionForm>
        </section>

        <section className="grid gap-3">
          <h2 className="font-serif text-2xl">{users.length} {users.length === 1 ? "user" : "users"}</h2>
          <ul className="grid gap-2">
            {users.map((user) => (
              <li key={user.id}>
                <a
                  href={`/admin/users/${user.id}`}
                  className="grid gap-1 rounded-xl border border-line bg-card px-4 py-3 transition hover:border-teal sm:grid-cols-[1fr_auto] sm:items-center"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">
                      {user.name}
                      {user.isOrgAdmin ? <span className="ml-2 text-xs text-teal">Org admin</span> : null}
                      {user.status === "disabled" ? <span className="ml-2 text-xs text-warn">Disabled</span> : null}
                      {user.mustChangePassword ? <span className="ml-2 text-xs text-muted">Temporary password</span> : null}
                    </span>
                    <span className="block truncate text-sm text-muted">{user.email}</span>
                  </span>
                  <span className="text-sm text-muted">
                    {user.workspaceCount} {user.workspaceCount === 1 ? "workspace" : "workspaces"} ·{" "}
                    {user.lastLoginAt ? (
                      <>last sign-in <LocalTime iso={user.lastLoginAt} withTime={false} /></>
                    ) : (
                      "never signed in"
                    )}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </section>
      </main>
    </>
  );
}
