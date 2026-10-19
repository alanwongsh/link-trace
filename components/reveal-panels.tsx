"use client";

import { useState, type ReactNode } from "react";

// A section heading with buttons that each open one form below it. Closed forms stay mounted,
// so a half-filled form keeps its values.
export function RevealPanels({
  heading,
  panels,
  defaultOpen = null,
}: {
  heading: ReactNode;
  panels: { key: string; label: string; content: ReactNode; primary?: boolean }[];
  defaultOpen?: string | null;
}) {
  const [open, setOpen] = useState<string | null>(defaultOpen);

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">{heading}</div>
        {panels.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {panels.map((panel) => (
              <button
                key={panel.key}
                type="button"
                aria-expanded={open === panel.key}
                aria-controls={`panel-${panel.key}`}
                onClick={() => setOpen(open === panel.key ? null : panel.key)}
                className={panel.primary && open !== panel.key ? "btn-primary" : "btn-secondary"}
              >
                {open === panel.key ? "Close" : panel.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
      {panels.map((panel) => (
        <div key={panel.key} id={`panel-${panel.key}`} hidden={open !== panel.key}>
          {panel.content}
        </div>
      ))}
    </div>
  );
}
