"use client";

import { useActionState } from "react";
import { setup } from "@/lib/actions";
import { MIN_PASSWORD_LENGTH } from "@/lib/password-rules";
import type { FormState } from "@/lib/types";

const initial: FormState = { error: "", ok: "" };

export function SetupForm({ configured }: { configured: boolean }) {
  const [state, action, pending] = useActionState(setup, initial);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center px-6 py-16">
      <p className="font-serif text-3xl tracking-tight">Set up Link Trace</p>
      <p className="mt-2 text-muted">
        Create the first org admin. Existing links go into the Default workspace, owned by you. After
        this, everyone signs in with their own email and password, and the shared password is no
        longer used.
      </p>
      {configured ? (
        <form action={action} className="mt-8 grid gap-3">
          <label htmlFor="setup_password" className="text-sm font-medium">
            Current dashboard password <span className="font-normal text-muted">ADMIN_PASSWORD</span>
          </label>
          <input id="setup_password" name="setup_password" type="password" required className="field" />
          <label htmlFor="name" className="mt-2 text-sm font-medium">
            Your name
          </label>
          <input id="name" name="name" type="text" maxLength={80} required className="field" />
          <label htmlFor="email" className="text-sm font-medium">
            Work email
          </label>
          <input id="email" name="email" type="email" autoComplete="username" required className="field" />
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
            Confirm password
          </label>
          <input id="confirm" name="confirm" type="password" autoComplete="new-password" required className="field" />
          {state.error ? (
            <p className="text-sm text-warn" role="alert">
              {state.error}
            </p>
          ) : null}
          <button type="submit" className="btn-primary" disabled={pending}>
            {pending ? "Creating…" : "Create admin account"}
          </button>
        </form>
      ) : (
        <p className="mt-8 rounded-2xl border border-line bg-card p-4 text-sm leading-6">
          Set <code className="font-mono">ADMIN_PASSWORD</code> on the server first. Setup asks for it, so
          only someone with server access can create the first admin.
        </p>
      )}
    </main>
  );
}
