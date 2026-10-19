"use client";

import { useActionState, type ReactNode } from "react";
import type { FormState } from "@/lib/types";

const initial: FormState = { error: "", ok: "" };

const BUTTONS = {
  primary: "btn-primary",
  secondary:
    "rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold transition hover:border-teal disabled:opacity-60",
  danger:
    "rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold text-warn transition hover:border-warn disabled:opacity-60",
} as const;

// A form for a server action that returns FormState, with its own submit button and messages.
export function ActionForm({
  action,
  children,
  submit,
  pending: pendingLabel = "Saving…",
  variant = "primary",
  confirm,
  className = "grid gap-3",
  inline = false,
  buttonLabel,
  quiet = false,
}: {
  action: (state: FormState, formData: FormData) => Promise<FormState>;
  children?: ReactNode;
  submit: string;
  pending?: string;
  variant?: keyof typeof BUTTONS;
  confirm?: string;
  className?: string;
  inline?: boolean;
  /** Accessible name when the button shows only a symbol. */
  buttonLabel?: string;
  /** Hide the success message, for small row controls. */
  quiet?: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, initial);

  return (
    <form
      action={formAction}
      className={inline ? "flex flex-wrap items-center gap-2" : className}
      onSubmit={
        confirm
          ? (event) => {
              if (!window.confirm(confirm)) event.preventDefault();
            }
          : undefined
      }
    >
      {children}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          className={BUTTONS[variant]}
          disabled={pending}
          aria-label={buttonLabel}
          title={buttonLabel}
        >
          {pending ? pendingLabel : submit}
        </button>
        {state.error ? (
          <p className="text-sm text-warn" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.ok && !quiet ? <p className="text-sm text-teal">{state.ok}</p> : null}
      </div>
    </form>
  );
}
