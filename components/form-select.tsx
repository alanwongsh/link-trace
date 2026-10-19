"use client";

import { useState } from "react";
import { FilterSelect, type FilterOption } from "@/components/filter-select";

// The common dropdown for plain forms (including server-rendered ones): it keeps its own value
// and submits it under name, like a native <select defaultValue>.
export function FormSelect({
  name,
  options,
  defaultValue = "",
  placeholder,
  ariaLabel,
  required = false,
  allowEmpty = false,
  fullWidth = false,
}: {
  name: string;
  options: FilterOption[];
  defaultValue?: string;
  placeholder: string;
  ariaLabel: string;
  required?: boolean;
  /** Offer the placeholder as a choice that clears the value. */
  allowEmpty?: boolean;
  fullWidth?: boolean;
}) {
  const [value, setValue] = useState(defaultValue);
  return (
    <FilterSelect
      name={name}
      value={value}
      onChange={setValue}
      options={options}
      placeholder={placeholder}
      ariaLabel={ariaLabel}
      required={required}
      hideEmptyOption={!allowEmpty}
      searchable={options.length > 10}
      fullWidth={fullWidth}
    />
  );
}
