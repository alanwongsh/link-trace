"use client";

import { useActionState } from "react";
import { login } from "@/lib/actions";
import type { FormState } from "@/lib/types";

const initial: FormState = { error: "", ok: "" };

export function LoginForm({ nextPath }: { nextPath: string }) {
  const [state, action, pending] = useActionState(login, initial);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <p className="font-serif text-3xl tracking-tight">Link Trace</p>
      <p className="mt-2 text-muted">Short links, with a log of who opened them.</p>
      <form action={action} className="mt-8 grid gap-3">
        <input type="hidden" name="next" value={nextPath} />
        <label htmlFor="email" className="text-sm font-medium">
          Work email
        </label>
        <input id="email" name="email" type="email" autoComplete="username" required className="field" />
        <label htmlFor="password" className="text-sm font-medium">
          Password
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
        <p className="text-sm text-muted">No account, or forgot your password? Ask an org admin.</p>
      </form>
    </main>
  );
}
