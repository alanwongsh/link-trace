import type { Role } from "@/lib/roles";

// The lowest workspace role allowed to do each thing. Code asks for a permission, never a role,
// so role-based control can later change this map (or replace it) without touching callers.
export const PERMISSIONS = {
  // Every member for now; to be narrowed when role-based control arrives.
  "parameters.manage": "viewer",
} as const satisfies Record<string, Role>;

export type Permission = keyof typeof PERMISSIONS;
