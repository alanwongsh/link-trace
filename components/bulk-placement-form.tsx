"use client";

import { useActionState, useState, useTransition } from "react";
import { bulkPlacements } from "@/lib/bulk-actions";
import { MAX_BULK_ROWS } from "@/lib/bulk-parse";
import type { BulkState } from "@/lib/types";

const initial: BulkState = { error: "", checked: false, ready: 0, problems: [], problemCount: 0, sample: [], jobId: "" };

export function BulkPlacementForm({ slug, columns }: { slug: string; columns: string[] }) {
  const [state, dispatch, pending] = useActionState(bulkPlacements, initial);
  const [, startTransition] = useTransition();
  // Kept in state and sent by hand, so a check does not clear the text.
  const [csv, setCsv] = useState("");
  const [format, setFormat] = useState<"png" | "svg">("png");
  const [checkedText, setCheckedText] = useState<string | null>(null);

  function send(intent: "check" | "create") {
    const data = new FormData();
    data.set("slug", slug);
    data.set("csv", csv);
    data.set("format", format);
    data.set("intent", intent);
    setCheckedText(csv);
    startTransition(() => dispatch(data));
  }

  // Create is offered only for the exact text that was last checked and passed.
  const canCreate = state.checked && !state.jobId && state.problemCount === 0 && state.ready > 0 && checkedText === csv;

  return (
    <div className="grid gap-3">
      <p className="text-sm text-muted">
        One row per placement. Line 1 lists the columns:{" "}
        <span className="font-mono">{columns.join(", ")}</span>. Only the rows given are created, up to{" "}
        {MAX_BULK_ROWS.toLocaleString("en")} at a time.{" "}
        <a href={`/stats/${slug}/bulk/template`} className="text-teal hover:underline">
          Download a template
        </a>
      </p>
      <label htmlFor="bulk-csv" className="sr-only">
        Placements CSV
      </label>
      <textarea
        id="bulk-csv"
        rows={6}
        spellCheck={false}
        value={csv}
        onChange={(event) => setCsv(event.target.value)}
        placeholder={`${columns.join(",")}\n…`}
        className="field font-mono text-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="cursor-pointer rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold transition hover:border-teal">
          Load CSV
          <input
            type="file"
            accept=".csv,text/csv,text/plain"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file) setCsv((await file.text()).trim());
              event.target.value = "";
            }}
          />
        </label>
        <fieldset className="flex items-center gap-3 text-sm">
          <legend className="sr-only">QR file type</legend>
          {(["png", "svg"] as const).map((value) => (
            <label key={value} className="flex items-center gap-1.5">
              <input type="radio" checked={format === value} onChange={() => setFormat(value)} />
              {value === "png" ? "PNG (1024 px, for print)" : "SVG (scalable)"}
            </label>
          ))}
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => send("check")}
          disabled={pending || !csv.trim()}
          className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold transition hover:border-teal disabled:opacity-60"
        >
          {pending ? "Working…" : "Check"}
        </button>
        {canCreate ? (
          <button type="button" onClick={() => send("create")} disabled={pending} className="btn-primary">
            Create {state.ready.toLocaleString("en")} placement{state.ready === 1 ? "" : "s"} and QR codes
          </button>
        ) : null}
        {state.error ? (
          <p className="text-sm text-warn" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>

      {state.jobId ? (
        <p className="rounded-xl border border-teal/40 bg-teal/5 px-4 py-3 text-sm text-teal" role="status">
          Queued {state.ready.toLocaleString("en")} placements. Progress and the download appear under Bulk uploads.
        </p>
      ) : state.checked && checkedText === csv ? (
        <div className="grid gap-2 rounded-xl border border-line bg-paper px-4 py-3 text-sm" role="status">
          {state.problemCount === 0 ? (
            <p className="font-medium text-teal">
              {state.ready.toLocaleString("en")} row{state.ready === 1 ? "" : "s"} ready.
            </p>
          ) : (
            <>
              <p className="font-medium text-warn">
                {state.problemCount} problem{state.problemCount === 1 ? "" : "s"} to fix. Nothing is created until the file
                is clean.
              </p>
              <ul className="grid gap-1">
                {state.problems.map((problem, index) => (
                  <li key={index}>
                    <span className="num text-muted">Line {problem.line}:</span> {problem.message}
                  </li>
                ))}
                {state.problemCount > state.problems.length ? (
                  <li className="text-muted">…and {state.problemCount - state.problems.length} more.</li>
                ) : null}
              </ul>
            </>
          )}
          {state.sample.length ? (
            <div>
              <p className="text-xs text-muted">First rows as read:</p>
              <ul className="mt-1 grid gap-1">
                {state.sample.map((row, index) => (
                  <li key={index} className="font-mono text-xs">
                    {row.join(" · ") || "(no labels)"}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
