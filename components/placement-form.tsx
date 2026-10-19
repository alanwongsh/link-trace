"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { createPlacement } from "@/lib/placement-actions";
import type { PlacementState } from "@/lib/types";
import { optionText, ParameterInputs, type PlacementField } from "./parameter-inputs";

export type { PlacementField };

const initial: PlacementState = { error: "", fieldErrors: {}, code: "" };

export function PlacementForm({
  slug,
  fields,
  base,
  manageHref,
}: {
  slug: string;
  fields: PlacementField[];
  base: string;
  manageHref: string;
}) {
  const [state, action, pending] = useActionState(createPlacement, initial);
  return (
    <Fields
      key={state.code || "new"}
      state={state}
      action={action}
      pending={pending}
      slug={slug}
      fields={fields}
      base={base}
      manageHref={manageHref}
    />
  );
}

function Fields({
  state,
  action,
  pending,
  slug,
  fields,
  base,
  manageHref,
}: {
  state: PlacementState;
  action: (formData: FormData) => void;
  pending: boolean;
  slug: string;
  fields: PlacementField[];
  base: string;
  manageHref: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [reviewing, setReviewing] = useState(false);
  const [summary, setSummary] = useState<{ label: string; value: string }[]>([]);
  // A rejected create goes back to the fields so their errors show.
  useEffect(() => {
    if (state.error) setReviewing(false);
  }, [state]);

  function review() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    const rows = [{ label: "Name", value: String(data.get("name") ?? "").trim() || "—" }];
    for (const field of fields) {
      const raw = String(data.get(`param:${field.key}`) ?? "").trim();
      const option = field.options.find((o) => o.value.toLowerCase() === raw.toLowerCase());
      rows.push({ label: field.name, value: raw ? (option ? optionText(option) : raw) : "—" });
    }
    setSummary(rows);
    setReviewing(true);
  }

  return (
    <form
      ref={formRef}
      action={action}
      className="grid gap-4"
      onSubmit={(event) => {
        // Enter in a field opens the review instead of creating straight away.
        if (!reviewing) {
          event.preventDefault();
          review();
        }
      }}
    >
      <input type="hidden" name="slug" value={slug} />
      {state.code ? (
        <p className="rounded-xl border border-teal/40 bg-teal/5 px-4 py-3 text-sm text-teal" role="status">
          Created <span className="font-mono">{`${base}/q/${state.code}`}</span>. Its QR code is in the list above.
        </p>
      ) : null}

      <div className={reviewing ? "hidden" : "grid gap-4"}>
        <div className="grid gap-2">
          <label htmlFor="placement-name" className="text-sm font-medium">
            Name <span className="font-normal text-muted">optional, such as “Entrance poster”</span>
          </label>
          <input id="placement-name" name="name" maxLength={80} className="field" />
        </div>
        {fields.length === 0 ? (
          <p className="text-sm text-muted">
            This workspace has no tracking parameters yet, so the placement only gets a name.{" "}
            <a href={manageHref} className="text-teal hover:underline">
              Add parameters
            </a>
          </p>
        ) : (
          <ParameterInputs fields={fields} errors={state.fieldErrors} />
        )}
      </div>

      {reviewing ? (
        <div className="grid gap-3">
          <p className="text-sm font-medium">Check before creating</p>
          <dl className="grid gap-x-6 gap-y-2 rounded-xl border border-line bg-paper px-4 py-3 text-sm sm:grid-cols-[max-content_1fr]">
            {summary.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted">{row.label}</dt>
                <dd className="font-medium">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-muted">
            The placement gets its own short address and QR code. Its labels cannot be changed afterwards; create a new
            placement instead.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {reviewing ? (
          <>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Creating…" : "Create placement"}
            </button>
            <button
              type="button"
              onClick={() => setReviewing(false)}
              className="rounded-full border border-line bg-paper px-4 py-2 text-sm font-semibold hover:border-teal"
            >
              Back
            </button>
          </>
        ) : (
          <button type="button" onClick={review} className="btn-primary">
            Review
          </button>
        )}
        {state.error ? (
          <p className="text-sm text-warn" role="alert">
            {state.error}
          </p>
        ) : null}
      </div>
    </form>
  );
}
