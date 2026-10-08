"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions";

export function LoginForm({
  configured,
  nextPath,
}: {
  configured: boolean;
  nextPath: string;
}) {
  const [state, action, pending] = useActionState(login, { error: "" });

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <p className="font-serif text-3xl tracking-tight">Link Trace</p>
      <p className="mt-2 text-muted">
        Short links, with a log of who opened them.
      </p>
      {configured ? (
        <form action={action} className="mt-8 grid gap-3">
          <input type="hidden" name="next" value={nextPath} />
          <label htmlFor="password" className="text-sm font-medium">
            Dashboard password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="field"
          />
          {state.error ? (
            <p className="text-sm text-warn" role="alert">
              {state.error}
            </p>
          ) : null}
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Checking…" : "Sign in"}
          </button>
        </form>
      ) : (
        <p className="mt-8 rounded-2xl border border-line bg-card p-4 text-sm leading-6">
          Set <code className="font-mono">ADMIN_PASSWORD</code> in{" "}
          <code className="font-mono">.env.local</code> for local use, or in the
          Vercel project settings before deploying.
        </p>
      )}
    </main>
  );
}
