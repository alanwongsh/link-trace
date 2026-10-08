import { logout } from "@/lib/actions";

export function TopBar({
  authed,
  meta,
}: {
  authed: boolean;
  meta?: string;
}) {
  return (
    <header className="border-b border-line">
      <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-5">
        <a href="/" className="font-serif text-2xl tracking-tight">
          Link Trace
        </a>
        <div className="flex items-center gap-4 text-sm text-muted">
          {meta ? <span>{meta}</span> : null}
          {authed ? (
            <form action={logout}>
              <button type="submit" className="transition hover:text-ink">
                Sign out
              </button>
            </form>
          ) : null}
        </div>
      </div>
    </header>
  );
}
