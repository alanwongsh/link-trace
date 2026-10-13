"use client";

import { useEffect, useState, type ChangeEvent } from "react";
import { PagePreview } from "@/components/page-preview";
import { MAX_PAGE_BYTES } from "@/lib/slug";
import type { LinkKind } from "@/lib/types";

// Where a link goes: a destination URL or hosted page HTML. Submits kind, url, and html.
// Fields are controlled so a failed submit, or switching kind, does not wipe what was typed.
export function TargetFields({
  initialKind = "redirect",
  initialUrl = "",
  initialHtml = "",
  idPrefix = "",
  onKindChange,
}: {
  initialKind?: LinkKind;
  initialUrl?: string;
  initialHtml?: string;
  idPrefix?: string;
  onKindChange?: (kind: LinkKind) => void;
}) {
  const [kind, setKind] = useState<LinkKind>(initialKind);
  const [url, setUrl] = useState(initialUrl);
  const [html, setHtml] = useState(initialHtml);
  const [fileError, setFileError] = useState("");
  const [previewHtml, setPreviewHtml] = useState(initialHtml);

  // Wait for a pause in typing so the preview does not reload on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewHtml(html), 400);
    return () => clearTimeout(timer);
  }, [html]);

  function chooseKind(next: LinkKind) {
    setKind(next);
    onKindChange?.(next);
  }

  async function loadFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > MAX_PAGE_BYTES) {
      setFileError("That file is over 512 KB.");
      return;
    }
    setFileError("");
    setHtml(await file.text());
  }

  return (
    <>
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Opens</legend>
        <div className="flex flex-wrap gap-2">
          <KindOption value="redirect" current={kind} onChange={chooseKind} label="Another website" />
          <KindOption value="page" current={kind} onChange={chooseKind} label="A page hosted here" />
        </div>
      </fieldset>
      {kind === "redirect" ? (
        <div className="grid gap-2">
          <label htmlFor={`${idPrefix}url`} className="text-sm font-medium">
            Destination
          </label>
          <input
            id={`${idPrefix}url`}
            name="url"
            type="url"
            required
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://example.com/post"
            className="field"
          />
        </div>
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor={`${idPrefix}html`} className="text-sm font-medium">
              Page HTML
            </label>
            <label className="cursor-pointer text-sm text-teal hover:underline">
              Load .html file
              <input type="file" accept=".html,.htm,text/html" className="sr-only" onChange={loadFile} />
            </label>
          </div>
          <textarea
            id={`${idPrefix}html`}
            name="html"
            required
            rows={10}
            value={html}
            onChange={(event) => setHtml(event.target.value)}
            placeholder={"<!doctype html>\n<html>\n  <body>\n    <h1>Hello</h1>\n  </body>\n</html>"}
            className="field font-mono text-xs"
            spellCheck={false}
          />
          <p className="text-xs text-muted">
            Up to 512 KB. Link to images and other files instead of embedding them. The page runs
            sandboxed, so its scripts cannot use cookies or local storage.
          </p>
          {fileError ? (
            <p className="text-sm text-warn" role="alert">
              {fileError}
            </p>
          ) : null}
          {previewHtml.trim() ? <PagePreview srcDoc={previewHtml} /> : null}
        </div>
      )}
      <input type="hidden" name="kind" value={kind} />
    </>
  );
}

function KindOption({
  value,
  current,
  onChange,
  label,
}: {
  value: LinkKind;
  current: LinkKind;
  onChange: (value: LinkKind) => void;
  label: string;
}) {
  const selected = value === current;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onChange(value)}
      className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
        selected ? "border-teal bg-teal text-card" : "border-line bg-paper text-ink hover:border-teal"
      }`}
    >
      {label}
    </button>
  );
}
