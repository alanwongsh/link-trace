"use client";

import { useState } from "react";
import { FilterMultiSelect, FilterSelect } from "@/components/filter-select";

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

// Lets dropdowns take several values, held by the parent so it can count the combinations.
export type MultiplePick = { values: Record<string, string[]>; onChange: (key: string, values: string[]) => void };

// One input per tracking parameter, named "param:<key>", as the placement actions expect.
// onRemove: shows a Remove button on each parameter.
export function ParameterInputs({
  fields,
  errors,
  idPrefix = "param",
  onRemove,
  multiple,
}: {
  fields: PlacementField[];
  errors: Record<string, string>;
  idPrefix?: string;
  onRemove?: (key: string) => void;
  multiple?: MultiplePick;
}) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.key}`;
        const error = errors[field.key];
        return (
          <div key={field.key} className="grid content-start gap-2">
            <div className="flex items-baseline justify-between gap-2">
              <label htmlFor={id} className="text-sm font-medium">
                {field.name}
              </label>
              {onRemove ? (
                <button type="button" onClick={() => onRemove(field.key)} className="text-xs text-muted hover:text-warn">
                  Remove
                </button>
              ) : null}
            </div>
            {field.fieldType === "dropdown" && multiple ? (
              <ParameterPicker
                id={id}
                field={field}
                invalid={Boolean(error)}
                values={multiple.values[field.key] ?? []}
                onChange={(values) => multiple.onChange(field.key, values)}
              />
            ) : field.fieldType === "dropdown" ? (
              <ParameterDropdown id={id} field={field} invalid={Boolean(error)} />
            ) : (
              <input
                id={id}
                name={`param:${field.key}`}
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

// A checkbox list; each ticked value is sent as its own "param:<key>" value.
function ParameterPicker({
  id,
  field,
  invalid,
  values,
  onChange,
}: {
  id: string;
  field: PlacementField;
  invalid: boolean;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  return (
    <>
      {values.map((value) => (
        <input key={value} type="hidden" name={`param:${field.key}`} value={value} />
      ))}
      <FilterMultiSelect
        id={id}
        value={values}
        onChange={onChange}
        options={field.options.map((option) => ({ value: option.value, label: optionText(option) }))}
        placeholder="None picked"
        searchable={field.options.length > SEARCH_FROM}
        invalid={invalid}
        showAll
        fullWidth
      />
    </>
  );
}

function ParameterDropdown({ id, field, invalid }: { id: string; field: PlacementField; invalid: boolean }) {
  const [value, setValue] = useState("");
  return (
    <FilterSelect
      id={id}
      name={`param:${field.key}`}
      value={value}
      onChange={setValue}
      options={field.options.map((option) => ({ value: option.value, label: optionText(option) }))}
      placeholder="None"
      searchable={field.options.length > SEARCH_FROM}
      invalid={invalid}
      fullWidth
    />
  );
}
