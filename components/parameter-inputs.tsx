"use client";

import { useState } from "react";
import { FilterSelect } from "@/components/filter-select";

export type PlacementField = {
  key: string;
  name: string;
  description: string | null;
  fieldType: "text" | "dropdown";
  isRequired: boolean;
  options: { value: string; label: string | null }[];
};

// Lists longer than this get a search box.
const SEARCH_FROM = 10;

export function optionText(option: { value: string; label: string | null }) {
  return option.label ? `${option.value} · ${option.label}` : option.value;
}

// One input per tracking parameter, named "param:<key>", as the placement actions expect.
export function ParameterInputs({
  fields,
  errors,
  idPrefix = "param",
}: {
  fields: PlacementField[];
  errors: Record<string, string>;
  idPrefix?: string;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const error = errors[field.key];
        return (
          <div key={field.key} className="grid content-start gap-2">
            <label htmlFor={id} className="text-sm font-medium">
              {field.name} <span className="font-normal text-muted">{field.isRequired ? "required" : "optional"}</span>
            </label>
            {field.fieldType === "dropdown" ? (
              <ParameterDropdown id={id} field={field} invalid={Boolean(error)} />
            ) : (
              <input
                id={id}
                name={`param:${field.key}`}
                required={field.isRequired}
                maxLength={200}
                className="field"
                aria-invalid={Boolean(error)}
              />
            )}
            {error ? (
              <p className="text-sm text-warn" role="alert">
                {error}
              </p>
            ) : field.description ? (
              <p className="text-xs text-muted">{field.description}</p>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ParameterDropdown({ id, field, invalid }: { id: string; field: PlacementField; invalid: boolean }) {
  const [value, setValue] = useState("");
  return (
    <FilterSelect
      id={id}
      name={`param:${field.key}`}
      required={field.isRequired}
      value={value}
      onChange={setValue}
      options={field.options.map((option) => ({ value: option.value, label: optionText(option) }))}
      placeholder={field.isRequired ? "Choose…" : "None"}
      hideEmptyOption={field.isRequired}
      searchable={field.options.length > SEARCH_FROM}
      invalid={invalid}
      fullWidth
    />
  );
}
