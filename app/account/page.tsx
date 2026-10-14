import { ActionForm } from "@/components/action-form";
import { TopBar } from "@/components/top-bar";
import { changePassword } from "@/lib/actions";
import { requireUser } from "@/lib/auth";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import { ROLE_LABELS } from "@/lib/roles";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requireUser({ allowPasswordChange: true });

  return (
    <>
      <TopBar />
      <main className="mx-auto grid max-w-3xl gap-8 px-6 py-10">
        <div>
          <h1 className="font-serif text-4xl tracking-tight">Your account</h1>
          <p className="mt-2 text-muted">
            {user.name} · {user.email}
            {user.isOrgAdmin ? " · Org admin" : ""}
          </p>
        </div>

        {user.mustChangePassword ? (
          <p className="rounded-2xl border border-teal bg-card p-4 text-sm">
            You signed in with a temporary password. Choose your own to continue.
          </p>
        ) : null}

        <section className="rounded-2xl border border-line bg-card p-5">
          <h2 className="font-serif text-2xl">Change password</h2>
          <ActionForm action={changePassword} submit="Change password" className="mt-4 grid max-w-md gap-3">
            <label htmlFor="current" className="text-sm font-medium">
              Current password
            </label>
            <input id="current" name="current" type="password" autoComplete="current-password" required className="field" />
            <label htmlFor="password" className="text-sm font-medium">
              New password <span className="font-normal text-muted">at least {MIN_PASSWORD_LENGTH} characters</span>
            </label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              minLength={MIN_PASSWORD_LENGTH}
              required
              className="field"
            />
            <label htmlFor="confirm" className="text-sm font-medium">
              Confirm new password
            </label>
            <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="field" />
          </ActionForm>
        </section>

        {!user.mustChangePassword ? (
          <section className="rounded-2xl border border-line bg-card p-5">
            <h2 className="font-serif text-2xl">Workspaces</h2>
            {user.isOrgAdmin ? (
              <p className="mt-2 text-sm text-muted">As an org admin you can see and manage every workspace.</p>
            ) : null}
            {user.memberships.length === 0 ? (
              <p className="mt-2 text-sm text-muted">You are not in any workspace yet. Ask an org admin to add you.</p>
            ) : (
              <ul className="mt-4 grid gap-2">
                {user.memberships.map((m) => (
                  <li key={m.workspaceId} className="flex flex-wrap justify-between gap-2 rounded-xl border border-line px-4 py-3">
                    <span className="font-medium">{m.workspaceName}</span>
                    <span className="text-sm text-muted">{ROLE_LABELS[m.role]}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ) : null}
      </main>
    </>
  );
}
