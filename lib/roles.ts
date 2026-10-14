// Shared by server and client code.
export const ROLE_NAMES = ["viewer", "editor", "owner"] as const;
export type Role = (typeof ROLE_NAMES)[number];

const RANK: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

export const ROLE_LABELS: Record<Role, string> = {
  viewer: "Viewer — sees links and stats",
  editor: "Editor — creates links and adds tags",
  owner: "Owner — also edits destinations, hosted pages, deletes and moves links",
};

export function atLeast(role: Role | null | undefined, min: Role): boolean {
  return Boolean(role) && RANK[role as Role] >= RANK[min];
}

export function isRole(value: unknown): value is Role {
  return typeof value === "string" && (ROLE_NAMES as readonly string[]).includes(value);
}
