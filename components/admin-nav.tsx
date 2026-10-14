const TABS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/workspaces", label: "Workspaces" },
  { href: "/admin/audit", label: "Audit log" },
] as const;

export function AdminNav({ current }: { current: (typeof TABS)[number]["href"] }) {
  return (
    <nav className="flex flex-wrap gap-2" aria-label="Admin">
      {TABS.map((tab) => (
        <a
          key={tab.href}
          href={tab.href}
          aria-current={tab.href === current ? "page" : undefined}
          className={`rounded-full border px-4 py-1.5 text-sm transition-colors ${
            tab.href === current ? "border-teal bg-teal text-card" : "border-line bg-paper hover:border-teal"
          }`}
        >
          {tab.label}
        </a>
      ))}
    </nav>
  );
}
