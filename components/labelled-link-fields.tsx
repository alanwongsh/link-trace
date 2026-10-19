"use client";

import { useEffect, useState } from "react";
import { FilterSelect } from "@/components/filter-select";
import { ParameterInputs, type PlacementField } from "@/components/parameter-inputs";
import { MAX_LABELLED_LINKS } from "@/lib/parameters";

// Combinations listed under the count; the rest are only counted.
const PREVIEW_ROWS = 6;

// The label fields for new labelled links, shared by the create-link form and the link page.
// Labels are added from a picker, all optional. A dropdown starts with all its options ticked,
// and every combination of the ticked values becomes one labelled link.
// onTotal reports that number (0 before any label is added) so the parent can word its button.
export function LabelledLinkFields({
  fields,
  errors,
  idPrefix,
  noLabels,
  onTotal,
}: {
  fields: PlacementField[];
  errors: Record<string, string>;
  idPrefix: string;
  // Shown instead of the fields when the workspace has no labels.
  noLabels: React.ReactNode;
  onTotal: (total: number) => void;
}) {
  // Rejected labels stay open so their errors show.
  const [picked, setPicked] = useState<string[]>(() => Object.keys(errors));
  const [ticked, setTicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(
      fields.filter((f) => f.fieldType === "dropdown" && f.key in errors).map((f) => [f.key, f.options.map((o) => o.value)]),
    ),
  );
  const shown = fields.filter((f) => picked.includes(f.key));
  const addable = fields.filter((f) => !picked.includes(f.key));
  const lists = shown.filter((f) => f.fieldType === "dropdown").map((f) => ({ field: f, values: ticked[f.key] ?? [] }));
  // 0 until a label is added, so the parent can tell "nothing picked" from one link.
  const total = shown.length === 0 ? 0 : lists.reduce((n, { values }) => n * Math.max(1, values.length), 1);
  const several = lists.filter(({ values }) => values.length > 1);

  useEffect(() => onTotal(total), [total, onTotal]);

  function addLabel(key: string) {
    const field = fields.find((f) => f.key === key);
    if (!field) return;
    setPicked((keys) => [...keys, key]);
    if (field.fieldType === "dropdown") setTicked((all) => ({ ...all, [key]: field.options.map((o) => o.value) }));
  }

  function removeLabel(key: string) {
    setPicked((keys) => keys.filter((k) => k !== key));
    setTicked(({ [key]: _, ...rest }) => rest);
  }

  if (fields.length === 0) return <>{noLabels}</>;

  return (
    <div className="grid gap-3">
      {shown.length > 0 ? (
        <ParameterInputs
          fields={shown}
          errors={errors}
          idPrefix={idPrefix}
          onRemove={removeLabel}
          multiple={{ values: ticked, onChange: (key, values) => setTicked((all) => ({ ...all, [key]: values })) }}
        />
      ) : null}
      {addable.length > 0 ? (
        <div className="max-w-xs">
          <FilterSelect
            id={`${idPrefix}-add`}
            value=""
            onChange={(key) => key && addLabel(key)}
            options={addable.map((f) => ({ value: f.key, label: f.name }))}
            placeholder="+ Add a label"
            hideEmptyOption
            searchable={addable.length > 10}
            fullWidth
          />
        </div>
      ) : null}

      {total > 1 ? (
        <div className="grid gap-2 rounded-lg border border-line bg-white px-3 py-2.5 text-sm" role="status">
          <p className={`font-medium ${total > MAX_LABELLED_LINKS ? "text-warn" : "text-teal"}`}>
            {several.map(({ field, values }) => `${values.length.toLocaleString("en")} ${field.name}`).join(" × ")} ={" "}
            {total.toLocaleString("en")} labelled links
            {total > MAX_LABELLED_LINKS ? ` · the limit is ${MAX_LABELLED_LINKS.toLocaleString("en")} at a time` : ""}
          </p>
          <ul className="grid gap-0.5 font-mono text-xs text-muted">
            {previewRows(lists.map(({ values }) => values), PREVIEW_ROWS).map((row) => (
              <li key={row.join("|")}>{row.join(" · ")}</li>
            ))}
            {total > PREVIEW_ROWS ? <li>…and {(total - PREVIEW_ROWS).toLocaleString("en")} more</li> : null}
          </ul>
          <fieldset className="flex flex-wrap items-center gap-3 text-xs">
            <legend className="sr-only">QR file type</legend>
            <span className="text-muted">QR files in the zip:</span>
            {(["png", "svg"] as const).map((format) => (
              <label key={format} className="flex items-center gap-1.5">
                <input type="radio" name="qr_format" value={format} defaultChecked={format === "png"} />
                {format === "png" ? "PNG (for print)" : "SVG (smaller, scalable)"}
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}

// The first combinations of the ticked values, in the same order the server makes them.
function previewRows(lists: string[][], limit: number): string[][] {
  let rows: string[][] = [[]];
  for (const list of lists) {
    if (list.length === 0) continue;
    rows = rows.flatMap((row) => list.map((value) => [...row, value])).slice(0, limit);
  }
  return rows;
}
