"use client";

import { useActionState } from "react";
import { createLink } from "@/lib/actions";
import { TagField } from "@/components/tag-field";
import type { CreateState } from "@/lib/types";

const initial: CreateState = { error: "", slug: "" };

export function CreateLinkForm() {
  const [state, action, pending] = useActionState(createLink, initial);

  return (
    <form
      key={state.slug || "new"}
      action={action}
      className="grid gap-3 rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,25,22,0.04)]"
    >
      <div className="grid gap-2">
        <label htmlFor="url" className="text-sm font-medium">
          Destination
        </label>
        <input
          id="url"
          name="url"
          type="url"
          required
          placeholder="https://example.com/post"
          className="field"
        />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="grid gap-2">
          <label htmlFor="title" className="text-sm font-medium">
            Name <span className="font-normal text-muted">optional</span>
          </label>
          <input id="title" name="title" type="text" maxLength={120} placeholder="Launch post" className="field" />
        </div>
        <div className="grid gap-2">
          <label htmlFor="slug" className="text-sm font-medium">
            Slug <span className="font-normal text-muted">optional</span>
          </label>
          <input id="slug" name="slug" type="text" maxLength={32} placeholder="auto" className="field" spellCheck={false} />
        </div>
      </div>
      <TagField
        id="tags"
        label="Platform tags"
        placeholder="instagram"
        hint="Press Enter or Add after each platform. Each tag gets its own address, such as /r/slug/instagram."
      />
      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.slug ? (
        <p className="text-sm text-teal">
          Created <span className="font-mono">/r/{state.slug}</span>
        </p>
      ) : null}
      <div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Creating…" : "Create link"}
        </button>
      </div>
    </form>
  );
}
