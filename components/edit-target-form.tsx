"use client";

import { useActionState, useEffect, useState } from "react";
import { editTarget } from "@/lib/actions";
import { TargetFields } from "@/components/target-fields";
import type { EditState, LinkKind } from "@/lib/types";

const initial: EditState = { error: "", savedAt: 0 };

export function EditTargetForm({
  slug,
  kind,
  url,
  html,
}: {
  slug: string;
  kind: LinkKind;
  url: string | null;
  html: string | null;
}) {
  const [state, action, pending] = useActionState(editTarget, initial);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (state.savedAt) setOpen(false);
  }, [state.savedAt]);

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
          Edit destination
        </button>
        {state.savedAt ? <p className="text-sm text-teal">Saved. The short link now opens the new destination.</p> : null}
      </div>
    );
  }

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="slug" value={slug} />
      <TargetFields
        idPrefix="edit-"
        initialKind={kind}
        initialUrl={url ?? ""}
        initialHtml={html ?? ""}
      />
      <p className="text-xs text-muted">
        The short link and its tags stay the same. Past visits are kept.
      </p>
      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          disabled={pending}
          className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm hover:border-teal"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
