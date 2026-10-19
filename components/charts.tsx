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

// One bar per day. Hovering or focusing a bar shows its date and count; a hidden table gives
// screen readers the same numbers.
export function DailyBars({ days, label }: { days: { day: string; clicks: number }[]; label: string }) {
  const max = Math.max(...days.map((day) => day.clicks), 0);
  return (
    <figure>
      <div className="mt-6 flex h-40 items-end gap-0.5" aria-hidden>
        {days.map((day) => {
          const height = max === 0 ? 3 : Math.max(3, (day.clicks / max) * 100);
          return (
            <div key={day.day} className="group relative flex h-full flex-1 flex-col justify-end">
              <div
                className="rounded-t bg-teal transition-opacity group-hover:opacity-80"
                style={{ height: `${height}%`, opacity: day.clicks === 0 ? 0.2 : undefined }}
              />
              <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 hidden -translate-x-1/2 whitespace-nowrap rounded-lg border border-line bg-card px-2.5 py-1.5 text-xs shadow-md group-hover:block">
                <span className="text-muted">{formatDay(day.day)}</span>{" "}
                <span className="num font-semibold">{day.clicks.toLocaleString("en")}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted" aria-hidden>
        <span>{days[0] ? formatDay(days[0].day) : ""}</span>
        <span>{days.at(-1) ? formatDay(days.at(-1)!.day) : ""}</span>
      </div>
      <table className="sr-only">
        <caption>{label}</caption>
        <thead>
          <tr>
            <th scope="col">Day (UTC)</th>
            <th scope="col">Clicks</th>
          </tr>
        </thead>
        <tbody>
          {days.map((day) => (
            <tr key={day.day}>
              <td>{formatDay(day.day)}</td>
              <td>{day.clicks}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

export function Breakdown({
  title,
  rows,
  empty = "No visits yet.",
}: {
  title: string;
  rows: { label: string; clicks: number; href?: string }[];
  empty?: string;
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
                  <span className="truncate">{row.label}</span>
                )}
                <span className="num text-muted">{row.clicks.toLocaleString("en")}</span>
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
    </article>
  );
}
