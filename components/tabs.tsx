// Page sections kept in the URL (?tab=…), so each one can be linked to and works without scripts.
export function Tabs({
  label,
  tabs,
}: {
  label: string;
  tabs: { href: string; label: string; count?: number; current: boolean }[];
}) {
  return (
    <nav aria-label={label} className="flex gap-6 overflow-x-auto border-b border-line">
      {tabs.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={tab.current ? "page" : undefined}
          className={`-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm transition ${
            tab.current ? "border-teal font-semibold text-ink" : "border-transparent text-muted hover:text-ink"
          }`}
        >
          {tab.label}
          {tab.count !== undefined ? (
            <span className="num rounded-full bg-paper px-2 py-0.5 text-xs text-muted">{tab.count}</span>
          ) : null}
        </a>
      ))}
    </nav>
  );
}
