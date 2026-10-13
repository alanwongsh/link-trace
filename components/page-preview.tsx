"use client";

import { useState } from "react";

// Same restrictions as the served page (lib/hosted-page.ts): no allow-same-origin, so the
// preview cannot read the dashboard session either.
const SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals";

const WIDTHS = {
  mobile: { label: "Mobile", width: "375px" },
  desktop: { label: "Desktop", width: "100%" },
} as const;

type Device = keyof typeof WIDTHS;

export function PagePreview({
  srcDoc,
  src,
  title = "Page preview",
}: {
  srcDoc?: string;
  src?: string;
  title?: string;
}) {
  const [device, setDevice] = useState<Device>("mobile");

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium">Preview</span>
        <div className="flex gap-1" role="group" aria-label="Preview width">
          {(Object.keys(WIDTHS) as Device[]).map((key) => (
            <button
              key={key}
              type="button"
              aria-pressed={device === key}
              onClick={() => setDevice(key)}
              className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                device === key ? "border-teal bg-teal text-card" : "border-line bg-paper text-ink hover:border-teal"
              }`}
            >
              {WIDTHS[key].label}
            </button>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-line bg-paper p-2">
        <iframe
          title={title}
          sandbox={SANDBOX}
          srcDoc={srcDoc}
          src={srcDoc === undefined ? src : undefined}
          style={{ width: WIDTHS[device].width }}
          className="mx-auto block h-[520px] max-w-full rounded-lg border-0 bg-white"
        />
      </div>
    </div>
  );
}
