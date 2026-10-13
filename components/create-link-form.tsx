"use client";

import { useActionState, useEffect, useState, type ChangeEvent } from "react";
import { createLink } from "@/lib/actions";
import { TagField } from "@/components/tag-field";
import { PagePreview } from "@/components/page-preview";
import { MAX_PAGE_BYTES } from "@/lib/slug";
import type { CreateState, LinkKind } from "@/lib/types";

const initial: CreateState = { error: "", slug: "" };

export function CreateLinkForm() {
  const [state, action, pending] = useActionState(createLink, initial);

  return <LinkFormFields key={state.slug || "new"} state={state} action={action} pending={pending} />;
}

function LinkFormFields({
  state,
  action,
  pending,
}: {
  state: CreateState;
  action: (formData: FormData) => void;
  pending: boolean;
}) {
  // Controlled so a failed submit does not wipe a pasted page.
  const [kind, setKind] = useState<LinkKind>("redirect");
  const [html, setHtml] = useState("");
  const [fileError, setFileError] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");

  // Wait for a pause in typing so the preview does not reload on every keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setPreviewHtml(html), 400);
    return () => clearTimeout(timer);
  }, [html]);

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
    <form
      action={action}
      className="grid gap-3 rounded-2xl border border-line bg-card p-5 shadow-[0_1px_0_rgba(28,25,22,0.04)]"
    >
      <fieldset className="grid gap-2">
        <legend className="mb-2 text-sm font-medium">Opens</legend>
        <div className="flex flex-wrap gap-2">
          <KindOption value="redirect" current={kind} onChange={setKind} label="Another website" />
          <KindOption value="page" current={kind} onChange={setKind} label="A page hosted here" />
        </div>
      </fieldset>
      {kind === "redirect" ? (
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
      ) : (
        <div className="grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor="html" className="text-sm font-medium">
              Page HTML
            </label>
            <label className="cursor-pointer text-sm text-teal hover:underline">
              Load .html file
              <input type="file" accept=".html,.htm,text/html" className="sr-only" onChange={loadFile} />
            </label>
          </div>
          <textarea
            id="html"
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
          {pending ? "Creating…" : kind === "page" ? "Create page" : "Create link"}
        </button>
      </div>
    </form>
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
