"use client";

import { useActionState } from "react";
import { addTags } from "@/lib/actions";
import { TagField } from "@/components/tag-field";
import type { TagState } from "@/lib/types";

const initial: TagState = { error: "", added: "" };

export function AddTagsForm({ slug }: { slug: string }) {
  const [state, action, pending] = useActionState(addTags, initial);

  return (
    <form key={state.added || "add"} action={action} className="mt-4 grid gap-2">
      <input type="hidden" name="slug" value={slug} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <TagField placeholder="youtube" />
        </div>
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Adding…" : "Add tags"}
        </button>
      </div>
      {state.error ? (
        <p className="text-sm text-warn" role="alert">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
