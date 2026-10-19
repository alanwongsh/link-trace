"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconButton, PencilIcon } from "@/components/icon-button";

const triggerClass =
  "inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400 sm:w-auto sm:min-w-[11rem] sm:max-w-[16rem]";

const menuClass =
  "absolute left-0 z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg sm:w-[min(18rem,90vw)]";

const fullTriggerClass =
  "inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400";

const fullMenuClass =
  "absolute left-0 z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg";

const SEARCH_LIMIT = 200;

export type FilterOption = {
  value: string;
  label: string;
  /** Options sharing a group are listed under that heading, in the order given. */
  group?: string;
};

function useMenuDismiss(open: boolean, setOpen: (v: boolean) => void) {
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, setOpen]);

  return rootRef;
}

function FilterLabel({ id, label }: { id: string; label?: string }) {
  if (!label) return null;
  return (
    <label
      htmlFor={id}
      className="mb-1.5 block text-xs font-semibold tracking-wide text-muted"
    >
      {label}
    </label>
  );
}

export function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  onEditOption,
  footer,
  fullWidth = false,
  hideEmptyOption = false,
  disabled = false,
  ariaLabel,
  id,
  name,
  required = false,
  searchable = false,
  invalid = false,
}: {
  /** Id for the trigger button, so an outside <label htmlFor> can name it. */
  id?: string;
  /** Inside a form: submits the value under this name. */
  name?: string;
  /** With name: the form will not submit until a value is chosen. */
  required?: boolean;
  /** Shows a search box above the options, for long lists. */
  searchable?: boolean;
  invalid?: boolean;
  label?: string;
  /** Accessible name when there is no visible label. */
  ariaLabel?: string;
  disabled?: boolean;
  value: string;
  onChange: (value: string) => void;
  options: FilterOption[];
  placeholder: string;
  onEditOption?: (option: FilterOption) => void;
  footer?: React.ReactNode;
  /** Stretch to the parent width. The filter bar keeps the compact width. */
  fullWidth?: boolean;
  /** Leave the placeholder out of the menu so one of the options must be picked. */
  hideEmptyOption?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const rootRef = useMenuDismiss(open, setOpen);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const generatedId = useId();
  const buttonId = id ?? generatedId;
  const selected = options.find((o) => o.value === value);
  const summary = selected?.label ?? placeholder;
  const needle = query.trim().toLowerCase();
  const matches = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  // Long lists render only the first matches; searching narrows them down.
  const shown = searchable ? matches.slice(0, SEARCH_LIMIT) : matches;

  return (
    <div
      className={fullWidth ? "relative w-full" : "relative w-full sm:w-auto"}
      ref={rootRef}
    >
      <FilterLabel id={buttonId} label={label} />
      {name ? (
        // Text, not hidden, so the browser checks required; it stays out of sight and out of tab order.
        <input
          type="text"
          name={name}
          value={value}
          required={required}
          onChange={() => {}}
          onInvalid={() => buttonRef.current?.focus()}
          tabIndex={-1}
          aria-hidden
          className="pointer-events-none absolute bottom-0 left-4 h-px w-px opacity-0"
        />
      ) : null}
      <button
        id={buttonId}
        ref={buttonRef}
        type="button"
        aria-label={label ? undefined : ariaLabel}
        aria-expanded={open}
        aria-controls={listId}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        className={`${
          fullWidth
            ? "inline-flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 text-sm font-medium text-slate-800 shadow-sm hover:border-slate-400"
            : triggerClass
        } ${invalid ? "border-warn" : ""} disabled:cursor-not-allowed disabled:opacity-60`}
        onClick={() => {
          setOpen((v) => !v);
          setQuery("");
        }}
      >
        <span className={`truncate ${value ? "" : "text-slate-500"}`}>
          {summary}
        </span>
        <span className="text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open && !disabled ? (
        <div
          id={listId}
          className={
            fullWidth
              ? "absolute left-0 z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white p-2 shadow-lg"
              : menuClass
          }
          role="listbox"
        >
          {searchable ? (
            <div className="mb-2">
              <input
                type="search"
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  // Enter picks the only match instead of submitting the form.
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (matches.length === 1) {
                      onChange(matches[0].value);
                      setOpen(false);
                    }
                  }
                }}
                placeholder="Search"
                aria-label={`Search ${label ?? ariaLabel ?? "options"}`}
                className="h-8 w-full rounded-md border border-slate-300 px-2 text-sm outline-none focus:border-teal"
              />
              {matches.length > shown.length ? (
                <p className="mt-1 px-1 text-xs text-muted">
                  Showing {shown.length} of {matches.length}. Type to narrow down.
                </p>
              ) : matches.length === 0 ? (
                <p className="mt-1 px-1 text-xs text-muted">No matches.</p>
              ) : null}
            </div>
          ) : null}
          <ul className="max-h-60 space-y-0.5 overflow-auto">
            {hideEmptyOption || needle ? null : (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={!value}
                  className={`flex w-full rounded-md px-2 py-1.5 text-left text-sm ${
                    !value
                      ? "bg-primary font-semibold text-white"
                      : "text-slate-700 hover:bg-paper hover:text-slate-900"
                  }`}
                  onClick={() => {
                    onChange("");
                    setOpen(false);
                  }}
                >
                  {placeholder}
                </button>
              </li>
            )}
            {shown.map((o, i) => {
              const active = o.value === value;
              const heading =
                o.group && o.group !== shown[i - 1]?.group ? (
                  <li
                    key={`group:${o.group}`}
                    role="presentation"
                    className="px-2 pt-2 pb-0.5 text-xs font-semibold tracking-wide text-muted uppercase"
                  >
                    {o.group}
                  </li>
                ) : null;
              return [
                heading,
                <li key={o.value} className="flex items-center gap-1">
                  <button
                    type="button"
                    role="option"
                    aria-selected={active}
                    className={`flex min-w-0 flex-1 rounded-md px-2 py-1.5 text-left text-sm ${
                      active
                        ? "bg-primary font-semibold text-white"
                        : "text-slate-700 hover:bg-paper hover:text-slate-900"
                    }`}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{o.label}</span>
                  </button>
                  {onEditOption ? (
                    <IconButton
                      label={`Edit ${o.label}`}
                      onClick={() => {
                        onEditOption(o);
                        setOpen(false);
                      }}
                    >
                      <PencilIcon />
                    </IconButton>
                  ) : null}
                </li>,
              ];
            })}
          </ul>
          {footer ? (
            <div
              className="mt-2 border-t border-slate-200 pt-2"
              onClick={() => setOpen(false)}
            >
              {footer}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function FilterMultiSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  fullWidth = false,
}: {
  label?: string;
  value: string[];
  onChange: (value: string[]) => void;
  options: FilterOption[];
  placeholder: string;
  /** Stretch to the parent width. The filter bar keeps the compact width. */
  fullWidth?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useMenuDismiss(open, setOpen);
  const listId = useId();
  const buttonId = useId();

  function toggle(code: string) {
    if (value.includes(code)) {
      onChange(value.filter((c) => c !== code));
    } else {
      onChange([...value, code]);
    }
  }

  const summary =
    value.length === 0
      ? placeholder
      : value.length === 1
        ? options.find((o) => o.value === value[0])?.label ?? "1 selected"
        : `${value.length} selected`;

  return (
    <div className={fullWidth ? "relative w-full" : "relative w-full sm:w-auto"} ref={rootRef}>
      <FilterLabel id={buttonId} label={label} />
      <button
        id={buttonId}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        className={fullWidth ? fullTriggerClass : triggerClass}
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`truncate ${value.length ? "" : "text-slate-500"}`}>
          {summary}
        </span>
        <span className="text-slate-400" aria-hidden>
          ▾
        </span>
      </button>
      {open ? (
        <div id={listId} className={fullWidth ? fullMenuClass : menuClass}>
          <div className="mb-1 flex items-center justify-between gap-2 px-1 pb-1">
            <button
              type="button"
              className="text-xs font-semibold text-primary hover:underline"
              onClick={() => onChange(options.map((o) => o.value))}
            >
              Select all
            </button>
            <button
              type="button"
              className="text-xs font-semibold text-slate-500 hover:underline"
              onClick={() => onChange([])}
            >
              Clear
            </button>
          </div>
          <ul className="max-h-60 space-y-0.5 overflow-auto">
            {options.map((o) => {
              const checked = value.includes(o.value);
              return (
                <li key={o.value}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-paper">
                    <input
                      type="checkbox"
                      className="accent-primary"
                      checked={checked}
                      onChange={() => toggle(o.value)}
                    />
                    <span className="flex-1 font-medium text-slate-900">
                      {o.label}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
