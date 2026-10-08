"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_TAGS, normalizeTag } from "@/lib/slug";

export function TagField({
  id,
  name = "tags",
  label,
  hint,
  placeholder = "instagram",
}: {
  id?: string;
  name?: string;
  label?: string;
  hint?: string;
  placeholder?: string;
}) {
  const [tags, setTags] = useState<string[]>([]);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const hiddenRef = useRef<HTMLInputElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const tagsRef = useRef(tags);
  const draftRef = useRef(draft);
  tagsRef.current = tags;
  draftRef.current = draft;

  function apply(current: string[], raw: string[]): { tags: string[]; error: string } {
    const next = [...current];
    for (const piece of raw) {
      const tag = normalizeTag(piece);
      if (!tag) return { tags: current, error: "Use 1–24 letters, numbers, and hyphens." };
      if (next.includes(tag)) continue;
      if (next.length >= MAX_TAGS) return { tags: next, error: `Use up to ${MAX_TAGS} tags.` };
      next.push(tag);
    }
    return { tags: next, error: "" };
  }

  function commit(raw: string) {
    const pieces = raw
      .split(/[,\n]+/)
      .map((part) => part.trim())
      .filter(Boolean);
    if (pieces.length === 0) return;
    const result = apply(tagsRef.current, pieces);
    tagsRef.current = result.tags;
    draftRef.current = "";
    setTags(result.tags);
    setDraft("");
    setError(result.error);
    if (hiddenRef.current) hiddenRef.current.value = result.tags.join(",");
  }

  useEffect(() => {
    const form = rootRef.current?.closest("form");
    if (!form) return;
    const onSubmit = () => commit(draftRef.current);
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, []);

  return (
    <div ref={rootRef} className="grid gap-2">
      {label ? (
        <label htmlFor={id} className="text-sm font-medium">
          {label} <span className="font-normal text-muted">optional</span>
        </label>
      ) : null}
      <div className="flex items-start gap-2">
      <div className="tag-box">
        {tags.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-paper px-2.5 py-1 text-sm text-teal"
          >
            {tag}
            <button
              type="button"
              className="px-0.5 text-muted hover:text-ink"
              aria-label={`Remove ${tag}`}
              onClick={() => {
                const next = tagsRef.current.filter((item) => item !== tag);
                tagsRef.current = next;
                setTags(next);
                if (hiddenRef.current) hiddenRef.current.value = next.join(",");
              }}
            >
              ×
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          id={id}
          value={draft}
          placeholder={tags.length === 0 ? placeholder : "Add another"}
          spellCheck={false}
          aria-label={label ?? "Platform tag"}
          onChange={(event) => {
            const value = event.target.value;
            draftRef.current = value;
            if (/[,\n]/.test(value)) {
              commit(value);
              return;
            }
            setDraft(value);
            setError("");
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              commit(event.currentTarget.value);
            } else if (event.key === "Backspace" && event.currentTarget.value === "" && tags.length > 0) {
              const next = tags.slice(0, -1);
              tagsRef.current = next;
              setTags(next);
              if (hiddenRef.current) hiddenRef.current.value = next.join(",");
            }
          }}
          onBlur={(event) => commit(event.currentTarget.value)}
        />
      </div>
        <button
          type="button"
          className="btn-primary shrink-0"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            commit(inputRef.current?.value ?? "");
            inputRef.current?.focus();
          }}
        >
          Add
        </button>
      </div>
      <input ref={hiddenRef} type="hidden" name={name} value={tags.join(",")} />
      {error ? (
        <p className="text-sm text-warn" role="alert">
          {error}
        </p>
      ) : null}
      {hint ? <p className="text-sm text-muted">{hint}</p> : null}
    </div>
  );
}
