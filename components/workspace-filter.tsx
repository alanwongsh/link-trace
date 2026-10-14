"use client";

import { useRouter } from "next/navigation";

// Dashboard filters, kept in the URL (?ws=…&mine=1) so a filtered view can be bookmarked or shared.
export function WorkspaceFilter({
  workspaces,
  current,
  mine,
  allLabel,
}: {
  workspaces: { id: string; name: string }[];
  current: string;
  mine: boolean;
  allLabel: string;
}) {
  const router = useRouter();

  function go(ws: string, onlyMine: boolean) {
    const params = new URLSearchParams();
    if (ws !== "all") params.set("ws", ws);
    if (onlyMine) params.set("mine", "1");
    const query = params.toString();
    router.push(query ? `/?${query}` : "/");
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <select
        value={current}
        onChange={(event) => go(event.target.value, mine)}
        className="field w-auto"
        aria-label="Workspace"
      >
        <option value="all">{allLabel}</option>
        {workspaces.map((w) => (
          <option key={w.id} value={w.id}>
            {w.name}
          </option>
        ))}
      </select>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={mine} onChange={(event) => go(current, event.target.checked)} />
        Created by me
      </label>
    </div>
  );
}
