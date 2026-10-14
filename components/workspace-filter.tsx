"use client";

import { useRouter } from "next/navigation";
import { type FilterOption, FilterSelect } from "./filter-select";

// Dashboard filters, kept in the URL (?ws=…&mine=1) so a filtered view can be bookmarked or shared.
export function WorkspaceFilter({
  workspaces,
  current,
  mine,
}: {
  workspaces: { id: string; name: string }[];
  current: string;
  mine: boolean;
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
      <FilterSelect 
        value={current}
        onChange={(value) => go(value, mine)}
        options={workspaces.map((workspace) => ({ label: workspace.name, value: workspace.id}))}
        placeholder="Select your workspace"
        fullWidth
      />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={mine} onChange={(event) => go(current, event.target.checked)} />
        Created by me
      </label>
    </div>
  );
}
