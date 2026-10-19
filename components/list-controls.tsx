import type { FilterOption } from "@/components/filter-select";
import { FormSelect } from "@/components/form-select";

// Shared controls for long lists: a filter bar and a pager. Both are plain links and GET forms, so
// a filtered page can be bookmarked or shared and works without scripts, like the tabs.

// ?page= as a page number from 1; anything else is page 1.
export function readPage(raw: string | undefined): number {
  const page = Number.parseInt(raw ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

export type ListFilter = {
  name: string;
  label: string;
  options: FilterOption[];
  // The value that means "no filter"; choosing it leaves the parameter out of the address.
  defaultValue: string;
  value: string;
};

// A search box and dropdown filters. keep: other address values to carry over (such as tab).
// Changing a filter always goes back to page 1.
export function ListFilters({
  action,
  keep = {},
  search,
  filters = [],
}: {
  action: string;
  keep?: Record<string, string>;
  search?: { value: string; placeholder: string; label: string };
  filters?: ListFilter[];
}) {
  const active = Boolean(search?.value) || filters.some((f) => f.value !== f.defaultValue);
  const clearHref = Object.keys(keep).length ? `${action}?${new URLSearchParams(keep)}` : action;
  return (
    <form action={action} className="flex flex-wrap items-center gap-2" role="search">
      {Object.entries(keep).map(([name, value]) => (
        <input key={name} type="hidden" name={name} value={value} />
      ))}
      {search ? (
        <input
          name="q"
          defaultValue={search.value}
          placeholder={search.placeholder}
          aria-label={search.label}
          className="field h-9 w-56 py-1.5"
        />
      ) : null}
      {filters.map((filter) => (
        <FormSelect
          key={filter.name}
          name={filter.name}
          defaultValue={filter.value}
          options={filter.options}
          placeholder={filter.label}
          ariaLabel={filter.label}
        />
      ))}
      <button type="submit" className="rounded-full border border-line bg-paper px-4 py-1.5 text-sm font-semibold hover:border-teal">
        Filter
      </button>
      {active ? (
        <a href={clearHref} className="text-sm text-teal">
          Clear
        </a>
      ) : null}
    </form>
  );
}

// Page numbers shown around the current one; the first and last are always shown.
const PAGE_WINDOW = 2;

// "Showing 26–50 of 1,000", Previous / Next and page numbers. href builds a page's address.
export function Pagination({
  page,
  pageSize,
  total,
  href,
  noun = "items",
}: {
  page: number;
  pageSize: number;
  total: number;
  href: (page: number) => string;
  noun?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  const first = Math.min((page - 1) * pageSize + 1, total);
  const last = Math.min(page * pageSize, total);
  const numbers = Array.from({ length: pages }, (_, i) => i + 1).filter(
    (n) => n === 1 || n === pages || Math.abs(n - page) <= PAGE_WINDOW,
  );

  return (
    <nav aria-label="Pages" className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p className="num text-muted">
        {page > pages
          ? `Page ${page} is past the end`
          : `Showing ${first.toLocaleString("en")}–${last.toLocaleString("en")} of ${total.toLocaleString("en")} ${noun}`}
      </p>
      {pages > 1 ? (
        <div className="flex flex-wrap items-center gap-1">
          {page > 1 ? <PageLink href={href(Math.min(page - 1, pages))}>Previous</PageLink> : null}
          {numbers.map((n, i) => (
            <span key={n} className="flex items-center gap-1">
              {i > 0 && n - numbers[i - 1] > 1 ? <span className="px-1 text-muted">…</span> : null}
              {n === page ? (
                <span aria-current="page" className="num rounded-full bg-ink px-3 py-1 font-semibold text-card">
                  {n}
                </span>
              ) : (
                <PageLink href={href(n)}>{n.toLocaleString("en")}</PageLink>
              )}
            </span>
          ))}
          {page < pages ? <PageLink href={href(page + 1)}>Next</PageLink> : null}
        </div>
      ) : null}
    </nav>
  );
}

function PageLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a href={href} className="num rounded-full px-3 py-1 text-teal no-underline hover:bg-paper">
      {children}
    </a>
  );
}
