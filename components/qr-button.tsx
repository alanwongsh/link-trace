"use client";

import { useRef } from "react";

// Opens a dialog with the QR code for a short link (or one of its tag links or placements) and
// download buttons. label names the tag or placement in the dialog.
export function QrButton({
  slug,
  tag,
  placement,
  label,
  url,
}: {
  slug: string;
  tag?: string;
  placement?: string;
  label?: string;
  url: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const query = placement ? `placement=${encodeURIComponent(placement)}&` : tag ? `tag=${encodeURIComponent(tag)}&` : "";
  const base = `/stats/${slug}/qr?${query}`;
  const name = label ?? tag;

  return (
    <>
      <button
        type="button"
        onClick={() => dialogRef.current?.showModal()}
        className="rounded-full border border-line bg-paper px-3 py-1 text-xs hover:border-teal"
      >
        QR
      </button>
      <dialog
        ref={dialogRef}
        onClick={(event) => {
          if (event.target === dialogRef.current) dialogRef.current?.close();
        }}
        className="m-auto max-h-[calc(100dvh-2rem)] w-[min(calc(100vw-2rem),360px)] overflow-y-auto rounded-2xl border border-line bg-card p-5 text-left text-base leading-normal text-ink backdrop:bg-black/40"
      >
        <div className="grid gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium">QR code{name ? ` · ${name}` : ""}</p>
              <p className="truncate font-mono text-xs text-teal">{url}</p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="-mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-paper hover:text-ink"
            >
              ✕
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route */}
          <img
            src={`${base}format=svg`}
            alt={`QR code for ${url}`}
            loading="lazy"
            className="mx-auto block aspect-square w-full max-w-[min(100%,50dvh)] rounded-lg bg-white"
          />
          <p className="text-xs text-muted">
            {placement ? "Visits count for this labelled link." : `Scans count as visits${tag ? ` tagged ${tag}` : ""}.`}
          </p>
          <div className="grid grid-cols-2 gap-2">
            <a
              href={`${base}format=png&download=1`}
              className="btn-primary inline-flex items-center justify-center whitespace-nowrap text-center no-underline"
            >
              Download PNG
            </a>
            <a
              href={`${base}format=svg&download=1`}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-full border border-line bg-paper px-4 py-2.5 text-sm font-semibold hover:border-teal"
            >
              Download SVG
            </a>
          </div>
        </div>
      </dialog>
    </>
  );
}
