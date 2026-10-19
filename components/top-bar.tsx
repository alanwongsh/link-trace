import { getCurrentUser } from "@/lib/auth";
import { logout } from "@/lib/actions";
import { NavLink } from "@/components/nav-link";

export async function TopBar({ meta }: { meta?: string }) {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-6 gap-y-3 px-6 py-5">
        <div className="flex items-baseline gap-5">
          <a href="/" className="font-serif text-2xl tracking-tight">
            Link Trace
          </a>
          {user && !user.mustChangePassword ? (
            <nav className="flex gap-5 text-sm text-muted">
              <NavLink href="/" match={["/", "/stats"]}>
                Dashboard
              </NavLink>
              {user.isOrgAdmin || user.memberships.length > 0 ? (
                <NavLink href="/parameters" match={["/parameters", "/workspaces"]}>
                  Labels
                </NavLink>
              ) : null}
              {user.isOrgAdmin ? (
                <NavLink href="/admin/users" match={["/admin"]}>
                  Admin
                </NavLink>
              ) : null}
            </nav>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-4 text-sm text-muted">
          {meta ? <span>{meta}</span> : null}
          {user ? (
            <>
              <a href="/account" className="transition hover:text-ink" title={user.email}>
                {user.name}
              </a>
              <form action={logout}>
                <button type="submit" className="transition hover:text-ink">
                  Sign out
                </button>
              </form>
            </>
          ) : null}
        </div>
      </div>
    </header>
  );
}
