"use client";

import { useActionState, useRef } from "react";
import { importOptions } from "@/lib/parameter-actions";
import { MAX_IMPORT_ROWS } from "@/lib/parameters";
import type { FormState } from "@/lib/types";

const initial: FormState = { error: "", ok: "" };

// Paste values, or load a CSV into the box first so it can be checked before importing.
export function OptionImportForm({ parameterId }: { parameterId: string }) {
  const [state, action, pending] = useActionState(importOptions, initial);
  const textRef = useRef<HTMLTextAreaElement>(null);

  return (
    <form action={action} className="grid gap-3">
      <input type="hidden" name="parameter_id" value={parameterId} />
      <label htmlFor="options" className="text-sm font-medium">
        Add options
      </label>
      <p className="-mt-1 text-sm text-muted">
        One per line: <span className="font-mono">code</span> or <span className="font-mono">code,label</span>. A
        header row starting with <span className="font-mono">value</span> is skipped. Codes that already exist are
        skipped. Up to {MAX_IMPORT_ROWS.toLocaleString("en")} at a time.
      </p>
      <textarea
        id="options"
        name="options"
        ref={textRef}
        rows={6}
        required
        spellCheck={false}
        placeholder={"KL001,Mid Valley\nPG002,Gurney Plaza"}
        className="field font-mono text-sm"
      />
      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn-primary" disabled={pending}>
          {pending ? "Importing…" : "Add options"}
        </button>
        <label className="cursor-pointer rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold transition hover:border-teal">
          Load CSV
          <input
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            className="sr-only"
            onChange={async (event) => {
              const file = event.target.files?.[0];
              if (file && textRef.current) textRef.current.value = (await file.text()).trim();
              event.target.value = "";
            }}
          />
        </label>
        {state.error ? (
          <p className="text-sm text-warn" role="alert">
            {state.error}
          </p>
        ) : null}
        {state.ok ? <p className="text-sm text-teal">{state.ok}</p> : null}
      </div>
    </form>
  );
}
