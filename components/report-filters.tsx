"use client";

import { useState } from "react";
import { FilterMultiSelect } from "@/components/filter-select";

// Lists longer than this get a search box.
const SEARCH_FROM = 10;

export type ReportFilterField = {
  key: string;
  name: string;
  // The values this link's labelled links use for the label.
  options: { value: string; label: string | null }[];
  // Ticked now; none means no filter on this label.
  values: string[];
};

// One dropdown per label; Apply reloads the report with ?f_<key>=value for each ticked value.
// keep carries the rest of the report's address (tab, by, range).
export function ReportFilters({
  action,
  keep,
  fields,
  clearHref,
}: {
  action: string;
  keep: Record<string, string>;
  fields: ReportFilterField[];
  clearHref: string | null;
}) {
  const [ticked, setTicked] = useState<Record<string, string[]>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.values])),
  );

  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {fields.map((field) =>
        (ticked[field.key] ?? []).map((value) => <input key={`${field.key}:${value}`} type="hidden" name={`f_${field.key}`} value={value} />),
      )}
      {fields.map((field) => (
        <div key={field.key} className="w-full sm:w-52">
          <FilterMultiSelect
            label={field.name}
            value={ticked[field.key] ?? []}
            onChange={(values) => setTicked((all) => ({ ...all, [field.key]: values }))}
            options={field.options.map((o) => ({ value: o.value, label: o.label ? `${o.value} · ${o.label}` : o.value }))}
            placeholder="All"
            searchable={field.options.length > SEARCH_FROM}
            showAll
            fullWidth
          />
        </div>
      ))}
      <button type="submit" className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm font-semibold hover:border-teal">
        Apply
      </button>
      {clearHref ? (
        <a href={clearHref} className="py-1.5 text-sm text-teal">
          Clear filters
        </a>
      ) : null}
    </form>
  );
}
