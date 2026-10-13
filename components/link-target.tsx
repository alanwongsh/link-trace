import type { LinkKind } from "@/lib/types";

// Where a short link goes: the destination URL, or a preview of the page hosted here.
export function LinkTarget({ slug, kind, url }: { slug: string; kind: LinkKind; url: string | null }) {
  if (kind === "page") {
    return (
      <p className="mt-1 truncate text-sm text-muted">
        Hosted page ·{" "}
        <a href={`/stats/${slug}/preview`} target="_blank" rel="noreferrer" className="text-teal hover:underline">
          Preview
        </a>
      </p>
    );
  }
  return (
    <a
      href={url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="mt-1 block truncate text-sm text-muted hover:text-ink"
      title={url ?? undefined}
    >
      {url}
    </a>
  );
}
