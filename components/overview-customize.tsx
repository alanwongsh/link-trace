"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilterSelect } from "@/components/filter-select";
import { LAYOUT_COOKIE, type OverviewLayout } from "@/lib/overview-layout";
import { RANGE_LABELS, REPORT_PERIODS, type ReportRange } from "@/lib/report-periods";

// Lets a viewer choose which Overview cards to show and the period it opens on. Kept in a cookie
// for a year, in this browser only, for every link.
export function OverviewCustomize({ cards, layout }: { cards: { key: string; name: string }[]; layout: OverviewLayout }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(new Set(layout.hidden));
  const [period, setPeriod] = useState<ReportRange>(layout.period);

  function save() {
    // Hidden cards that are not on this link (another link's labels) are kept as they were.
    const value: OverviewLayout = { period, hidden: [...hidden] };
    document.cookie = `${LAYOUT_COOKIE}=${encodeURIComponent(JSON.stringify(value))}; path=/; max-age=${365 * 24 * 3600}; samesite=lax`;
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm font-semibold hover:border-teal"
      >
        Customize ▾
      </button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 grid w-72 gap-3 rounded-xl border border-line bg-card p-4 text-sm shadow-lg">
          <fieldset className="grid gap-1.5">
            <legend className="mb-1 text-xs font-semibold text-muted uppercase">Show</legend>
            {cards.map((card) => (
              <label key={card.key} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="accent-primary"
                  checked={!hidden.has(card.key)}
                  onChange={(event) =>
                    setHidden((all) => {
                      const next = new Set(all);
                      if (event.target.checked) next.delete(card.key);
                      else next.add(card.key);
                      return next;
                    })
                  }
                />
                {card.name}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-1">
            <label htmlFor="overview-period" className="text-xs font-semibold text-muted uppercase">
              Open on
            </label>
            <FilterSelect
              id="overview-period"
              value={period}
              onChange={(value) => value && setPeriod(value as ReportRange)}
              options={REPORT_PERIODS.map((p) => ({ value: p, label: RANGE_LABELS[p] }))}
              placeholder="Choose a period"
              hideEmptyOption
              fullWidth
            />
          </div>
          <p className="text-xs text-muted">Saved in this browser, for every link.</p>
          <div className="flex gap-2">
            <button type="button" onClick={save} className="btn-primary text-sm">
              Save
            </button>
            <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
