import { FormSelect } from "@/components/form-select";
import { ROLE_NAMES, type Role } from "@/lib/roles";

const SHORT: Record<Role, string> = { viewer: "Viewer", editor: "Editor", owner: "Owner" };

export function RoleSelect({ defaultValue, name = "role" }: { defaultValue: Role; name?: string }) {
  return (
    <FormSelect
      name={name}
      defaultValue={defaultValue}
      options={ROLE_NAMES.map((role) => ({ value: role, label: SHORT[role] }))}
      placeholder="Role"
      ariaLabel="Role"
      required
    />
  );
}
