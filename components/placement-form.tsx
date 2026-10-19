"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { LabelledLinkFields } from "@/components/labelled-link-fields";
import { MAX_LABELLED_LINKS } from "@/lib/parameters";
import { createPlacement } from "@/lib/placement-actions";
import type { PlacementState } from "@/lib/types";
import { optionText, type PlacementField } from "./parameter-inputs";

export type { PlacementField };

const initial: PlacementState = { error: "", fieldErrors: {}, code: "" };
// Values listed per label in the review; the rest are counted.
const REVIEW_VALUES = 8;

function skippedText(count: number) {
  return `${count.toLocaleString("en")} already existed with the same labels and ${count === 1 ? "was" : "were"} skipped.`;
}

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
      key={state.code || state.queuedJobId || "new"}
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
  // How many labelled links the ticked values make, reported by the fields.
  const [total, setTotal] = useState(1);
  // A rejected create goes back to the fields so their errors show.
  useEffect(() => {
    if (state.error) setReviewing(false);
  }, [state]);

  function review() {
    const form = formRef.current;
    if (!form || !form.reportValidity()) return;
    const data = new FormData(form);
    const rows: { label: string; value: string }[] = [];
    for (const field of fields) {
      if (!data.has(`param:${field.key}`)) continue;
      const picked = data
        .getAll(`param:${field.key}`)
        .map((raw) => String(raw).trim())
        .filter(Boolean)
        .map((raw) => {
          const option = field.options.find((o) => o.value.toLowerCase() === raw.toLowerCase());
          return option ? optionText(option) : raw;
        });
      const listed = picked.length > REVIEW_VALUES ? `${picked.slice(0, REVIEW_VALUES).join(", ")} and ${picked.length - REVIEW_VALUES} more` : picked.join(", ");
      rows.push({ label: field.name, value: listed || "—" });
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
          Created <span className="font-mono">{`${base}/q/${state.code}`}</span>. It&apos;s in the list below.
          {state.skippedCount ? ` ${skippedText(state.skippedCount)}` : ""}
        </p>
      ) : state.queuedCount ? (
        <p className="rounded-xl border border-teal/40 bg-teal/5 px-4 py-3 text-sm text-teal" role="status">
          Making {state.queuedCount.toLocaleString("en")} labelled links. Zips of their QR codes appear under QR
          code downloads when ready.{state.skippedCount ? ` ${skippedText(state.skippedCount)}` : ""}
        </p>
      ) : null}

      <div className={reviewing ? "hidden" : "grid gap-4"}>
        <LabelledLinkFields
          fields={fields}
          errors={state.fieldErrors}
          idPrefix="param"
          onTotal={setTotal}
          noLabels={
            <p className="text-sm text-muted">
              This workspace has no labels yet, so the labelled link gets none.{" "}
              <a href={manageHref} className="text-teal hover:underline">
                Add labels
              </a>
            </p>
          }
        />
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
            {total > 1 ? `Each of the ${total.toLocaleString("en")} labelled links gets` : "The labelled link gets"} its own short address and QR code. Labels
            cannot be changed afterwards, since it may already be printed or sent; create a new one instead.
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        {reviewing ? (
          <>
            <button type="submit" className="btn-primary" disabled={pending}>
              {pending ? "Creating…" : total > 1 ? `Create ${total.toLocaleString("en")} labelled links` : "Create labelled link"}
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
          <button
            type="button"
            onClick={review}
            className="btn-primary"
            // A workspace with labels needs at least one picked; one without can still make a plain one.
            disabled={total > MAX_LABELLED_LINKS || (total === 0 && fields.length > 0)}
          >
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
