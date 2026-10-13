"use client";

import { useRef } from "react";

// Opens a dialog with the QR code for a short link (or one of its tag links) and download buttons.
export function QrButton({ slug, tag, url }: { slug: string; tag?: string; url: string }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const base = `/stats/${slug}/qr?${tag ? `tag=${encodeURIComponent(tag)}&` : ""}`;

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
        className="m-auto w-[min(92vw,360px)] rounded-2xl border border-line bg-card p-5 text-ink backdrop:bg-black/40"
      >
        <div className="grid gap-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-medium">QR code{tag ? ` · ${tag}` : ""}</p>
              <p className="truncate font-mono text-xs text-teal">{url}</p>
            </div>
            <button
              type="button"
              onClick={() => dialogRef.current?.close()}
              aria-label="Close"
              className="text-muted hover:text-ink"
            >
              ✕
            </button>
          </div>
          {/* eslint-disable-next-line @next/next/no-img-element -- served by our own route */}
          <img
            src={`${base}format=svg`}
            alt={`QR code for ${url}`}
            loading="lazy"
            className="aspect-square w-full rounded-lg bg-white"
          />
          <p className="text-xs text-muted">Scans count as visits{tag ? ` tagged ${tag}` : ""}.</p>
          <div className="flex flex-wrap gap-2">
            <a href={`${base}format=png&download=1`} className="btn-primary">
              Download PNG
            </a>
            <a
              href={`${base}format=svg&download=1`}
              className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm hover:border-teal"
            >
              Download SVG
            </a>
          </div>
        </div>
      </dialog>
    </>
  );
}
