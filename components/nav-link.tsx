"use client";

import { usePathname } from "next/navigation";

// A top-bar link that marks itself current when the page sits under any of its paths.
export function NavLink({ href, match, children }: { href: string; match: string[]; children: React.ReactNode }) {
  const pathname = usePathname();
  const current = match.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));
  return (
    <a
      href={href}
      aria-current={current ? "page" : undefined}
      className={`-mb-px border-b-2 pb-1 transition ${
        current ? "border-teal font-semibold text-ink" : "border-transparent hover:text-ink"
      }`}
    >
      {children}
    </a>
  );
}
