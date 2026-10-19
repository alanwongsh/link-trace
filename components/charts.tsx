import { formatDay } from "@/lib/track";

export function Stat({ label, value, hint }: { label: string; value: number; hint: string }) {
  return (
    <article className="rounded-2xl border border-line bg-card px-4 py-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="num mt-1 font-serif text-4xl">{value.toLocaleString("en")}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </article>
  );
}

// One bar per day. zone names the timezone the days are counted in, such as "GMT+8".
export function DailyBars({ days, label, zone }: { days: { day: string; clicks: number }[]; label: string; zone: string }) {
  return (
    <Bars bars={days.map((d) => ({ key: d.day, label: formatDay(d.day), clicks: d.clicks }))} label={label} unit={`Day (${zone})`} />
  );
}

// One bar per hour, day or month. Hovering a bar shows its label and count; a hidden table gives
// screen readers the same numbers. unit heads that table's first column, such as "Hour (GMT+8)".
export function Bars({ bars, label, unit }: { bars: { key: string; label: string; clicks: number }[]; label: string; unit: string }) {
  const max = Math.max(...bars.map((bar) => bar.clicks), 0);
  return (
    <figure>
      <div className="mt-6 flex h-40 items-end gap-0.5" aria-hidden>
        {bars.map((bar) => {
          const height = max === 0 ? 3 : Math.max(3, (bar.clicks / max) * 100);
          return (
            <div key={bar.key} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className="rounded-t bg-teal transition-opacity group-hover:opacity-80"
                style={{ height: `${height}%`, opacity: bar.clicks === 0 ? 0.2 : undefined }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-md group-hover:block">
                <span className="text-muted">{bar.label}</span>{" "}
                <span className="num font-semibold">{bar.clicks.toLocaleString("en")}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted" aria-hidden>
        <span>{bars[0]?.label ?? ""}</span>
        <span>{bars.at(-1)?.label ?? ""}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">{unit}</th>
            <th scope="col">Clicks</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.key}>
              <td>{bar.label}</td>
              <td>{bar.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

// A short ranked list with bars. total: show each row's share of it; more: a link under the list.
export function Breakdown({
  title,
  rows,
  empty = "No visits yet.",
  total,
  more,
}: {
  title: string;
  rows: { label: string; clicks: number; href?: string; note?: string }[];
  empty?: string;
  total?: number;
  more?: { href: string; label: string };
}) {
  const max = Math.max(...rows.map((row) => row.clicks), 0);
  return (
    <article className="rounded-2xl border border-line bg-card p-5">
      <h2 className="sub-title">{title}</h2>
      {rows.length === 0 ? (
        <p className="mt-4 text-sm text-muted">{empty}</p>
      ) : (
        <ul className="mt-4 grid gap-3">
          {rows.map((row) => (
            <li key={row.label}>
              <div className="flex items-baseline justify-between gap-3 text-sm">
                {row.href ? (
                  <a href={row.href} className="truncate hover:text-teal">
                    {row.label}
                  </a>
                ) : (
                  <span className="truncate">
                    {row.label}
                    {row.note ? <span className="text-muted"> · {row.note}</span> : null}
                  </span>
                )}
                <span className="num shrink-0 text-muted">
                  {row.clicks.toLocaleString("en")}
                  {total ? ` · ${Math.round((row.clicks / total) * 100)}%` : ""}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-paper">
                <div
                  className="h-1.5 rounded-full bg-teal"
                  style={{ width: `${max === 0 ? 0 : (row.clicks / max) * 100}%` }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {more && rows.length > 0 ? (
        <a href={more.href} className="mt-4 inline-block text-sm text-teal hover:underline">
          {more.label}
        </a>
      ) : null}
    </article>
  );
}
