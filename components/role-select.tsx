import { ROLE_NAMES, type Role } from "@/lib/roles";

const SHORT: Record<Role, string> = { viewer: "Viewer", editor: "Editor", owner: "Owner" };

export function RoleSelect({ defaultValue, name = "role" }: { defaultValue: Role; name?: string }) {
  return (
    <select name={name} defaultValue={defaultValue} className="field w-auto" aria-label="Role">
      {ROLE_NAMES.map((role) => (
        <option key={role} value={role}>
          {SHORT[role]}
        </option>
      ))}
    </select>
  );
}
