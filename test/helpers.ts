import { sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import { memberships, users, workspaces } from "@/lib/db/schema";
import type { SessionUser } from "@/lib/accounts";
import type { Role } from "@/lib/roles";

export function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

export async function resetData(): Promise<void> {
  await db().execute(
    sql.raw("truncate clicks, placement_values, placements, bulk_jobs, links, tracking_parameter_options, tracking_parameters, audit_log, sessions, memberships, users, workspaces restart identity cascade"),
  );
}

let counter = 0;

export async function createWorkspace(name = `Workspace ${++counter}`): Promise<string> {
  const [row] = await db().insert(workspaces).values({ name }).returning({ id: workspaces.id });
  return row.id;
}

// A signed-in user as requireUser() would return it.
export async function createUser(
  roles: Record<string, Role> = {},
  options: { isOrgAdmin?: boolean } = {},
): Promise<SessionUser> {
  const n = ++counter;
  const [row] = await db()
    .insert(users)
    .values({ email: `user${n}@example.com`, name: `User ${n}`, isOrgAdmin: options.isOrgAdmin ?? false })
    .returning({ id: users.id, email: users.email, name: users.name });
  const list: SessionUser["memberships"] = [];
  for (const [workspaceId, role] of Object.entries(roles)) {
    await db().insert(memberships).values({ workspaceId, userId: row.id, role });
    list.push({ workspaceId, workspaceName: "", role });
  }
  return { ...row, isOrgAdmin: options.isOrgAdmin ?? false, mustChangePassword: false, memberships: list };
}

export function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}
