"use client";

import { removeLink } from "@/lib/actions";

export function DeleteLinkButton({ slug }: { slug: string }) {
  return (
    <form
      action={removeLink}
      onSubmit={(event) => {
        if (!window.confirm("Delete this link and its visitor log?")) {
          event.preventDefault();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      <button type="submit" className="text-sm text-muted transition hover:text-warn">
        Delete
      </button>
    </form>
  );
}
