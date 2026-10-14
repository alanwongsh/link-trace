import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { and, asc, count, desc, eq, gt, inArray, ne, sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import { auditLog, links, memberships, sessions, users, workspaces } from "@/lib/db/schema";
import type { Role } from "@/lib/roles";

// Account queries throw on database errors; callers in actions turn them into messages.
function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

export const SESSION_DAYS = 30;

export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  isOrgAdmin: boolean;
  mustChangePassword: boolean;
  memberships: { workspaceId: string; workspaceName: string; role: Role }[];
};

// ---- Sessions ----

export async function createSession(userId: string): Promise<{ token: string; maxAge: number }> {
  const token = randomBytes(32).toString("base64url");
  const maxAge = SESSION_DAYS * 24 * 60 * 60;
  await db()
    .insert(sessions)
    .values({
      tokenHash: hashToken(token),
      userId,
      expiresAt: new Date(Date.now() + maxAge * 1000).toISOString(),
    });
  return { token, maxAge };
}

export async function deleteSession(token: string): Promise<void> {
  await db().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
}

// Signs the user out everywhere, optionally keeping the session making the request.
export async function deleteUserSessions(userId: string, keepToken?: string): Promise<void> {
  const where = keepToken
    ? and(eq(sessions.userId, userId), ne(sessions.tokenHash, hashToken(keepToken)))
    : eq(sessions.userId, userId);
  await db().delete(sessions).where(where);
}

export async function userForSession(token: string): Promise<SessionUser | null> {
  const [row] = await db()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isOrgAdmin: users.isOrgAdmin,
      mustChangePassword: users.mustChangePassword,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, sql`now()`),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  if (!row) return null;
  return { ...row, memberships: await membershipsFor(row.id) };
}

// ---- Users ----

export async function countUsers(): Promise<number> {
  const [row] = await db().select({ n: count() }).from(users);
  return row?.n ?? 0;
}

export async function findUserByEmail(email: string) {
  const [row] = await db().select().from(users).where(eq(users.email, email)).limit(1);
  return row ?? null;
}

export async function findUserById(id: string) {
  const [row] = await db().select().from(users).where(eq(users.id, id)).limit(1);
  return row ?? null;
}

export async function listUsers() {
  return db()
    .select({
      id: users.id,
      email: users.email,
      name: users.name,
      isOrgAdmin: users.isOrgAdmin,
      status: users.status,
      hasPassword: sql<boolean>`${users.passwordHash} is not null`,
      mustChangePassword: users.mustChangePassword,
      lastLoginAt: users.lastLoginAt,
      createdAt: users.createdAt,
      workspaceCount: sql<number>`(select count(*)::int from ${memberships} where ${memberships.userId} = ${users.id})`,
    })
    .from(users)
    .orderBy(asc(users.name));
}

export async function insertUser(input: {
  email: string;
  name: string;
  passwordHash: string | null;
  isOrgAdmin: boolean;
  mustChangePassword: boolean;
}): Promise<{ id: string } | "duplicate"> {
  try {
    const [row] = await db().insert(users).values(input).returning({ id: users.id });
    return row;
  } catch (error) {
    if (pgCode(error) === "23505") return "duplicate";
    throw error;
  }
}

export async function updateUser(
  id: string,
  values: Partial<{
    name: string;
    passwordHash: string | null;
    mustChangePassword: boolean;
    isOrgAdmin: boolean;
    status: "active" | "disabled";
    failedLogins: number;
    lockedUntil: string | null;
    lastLoginAt: string;
  }>,
): Promise<void> {
  await db().update(users).set(values).where(eq(users.id, id));
}

export async function countActiveOrgAdmins(): Promise<number> {
  const [row] = await db()
    .select({ n: count() })
    .from(users)
    .where(and(eq(users.isOrgAdmin, true), eq(users.status, "active")));
  return row?.n ?? 0;
}

// ---- Workspaces and memberships ----

export async function listWorkspaces() {
  return db()
    .select({
      id: workspaces.id,
      name: workspaces.name,
      createdAt: workspaces.createdAt,
      memberCount: sql<number>`(select count(*)::int from ${memberships} where ${memberships.workspaceId} = ${workspaces.id})`,
      linkCount: sql<number>`(select count(*)::int from ${links} where ${links.workspaceId} = ${workspaces.id})`,
    })
    .from(workspaces)
    .orderBy(asc(workspaces.name));
}

export async function findWorkspace(id: string) {
  const [row] = await db().select().from(workspaces).where(eq(workspaces.id, id)).limit(1);
  return row ?? null;
}

export async function insertWorkspace(name: string): Promise<{ id: string } | "duplicate"> {
  try {
    const [row] = await db().insert(workspaces).values({ name }).returning({ id: workspaces.id });
    return row;
  } catch (error) {
    if (pgCode(error) === "23505") return "duplicate";
    throw error;
  }
}

export async function renameWorkspace(id: string, name: string): Promise<"ok" | "duplicate"> {
  try {
    await db().update(workspaces).set({ name }).where(eq(workspaces.id, id));
    return "ok";
  } catch (error) {
    if (pgCode(error) === "23505") return "duplicate";
    throw error;
  }
}

// Workspaces that still hold links cannot be deleted (links.workspace_id is ON DELETE RESTRICT).
export async function deleteWorkspace(id: string): Promise<"ok" | "has-links"> {
  try {
    await db().delete(workspaces).where(eq(workspaces.id, id));
    return "ok";
  } catch (error) {
    if (pgCode(error) === "23503") return "has-links";
    throw error;
  }
}

export async function membershipsFor(userId: string) {
  return db()
    .select({
      workspaceId: memberships.workspaceId,
      workspaceName: workspaces.name,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .where(eq(memberships.userId, userId))
    .orderBy(asc(workspaces.name));
}

export async function workspaceMembers(workspaceId: string) {
  return db()
    .select({
      userId: users.id,
      email: users.email,
      name: users.name,
      status: users.status,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(users, eq(users.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId))
    .orderBy(asc(users.name));
}

export async function setMembership(workspaceId: string, userId: string, role: Role): Promise<void> {
  await db()
    .insert(memberships)
    .values({ workspaceId, userId, role })
    .onConflictDoUpdate({ target: [memberships.workspaceId, memberships.userId], set: { role } });
}

export async function removeMembership(workspaceId: string, userId: string): Promise<void> {
  await db()
    .delete(memberships)
    .where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
}

export async function workspaceNames(ids: string[]): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db()
    .select({ id: workspaces.id, name: workspaces.name })
    .from(workspaces)
    .where(inArray(workspaces.id, ids));
  return new Map(rows.map((row) => [row.id, row.name]));
}

// ---- First-run setup ----

// Creates the first org admin, owner of "Default". The advisory lock stops two setups racing.
export async function createFirstAdmin(input: {
  email: string;
  name: string;
  passwordHash: string;
}): Promise<{ id: string } | "already-set-up"> {
  return db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('link-trace-setup'))`);
    const [existing] = await tx.select({ n: count() }).from(users);
    if ((existing?.n ?? 0) > 0) return "already-set-up";

    const [user] = await tx
      .insert(users)
      .values({ ...input, isOrgAdmin: true, mustChangePassword: false })
      .returning({ id: users.id });
    await tx.insert(workspaces).values({ name: "Default" }).onConflictDoNothing();
    const [workspace] = await tx
      .select({ id: workspaces.id })
      .from(workspaces)
      .where(eq(workspaces.name, "Default"));
    await tx.insert(memberships).values({ workspaceId: workspace.id, userId: user.id, role: "owner" });
    return user;
  });
}

// ---- Audit log ----

export type AuditEntry = {
  actor: { id: string; email: string } | null;
  action: string;
  workspaceId?: string | null;
  targetType?: string;
  targetId?: string;
  details?: Record<string, unknown>;
};

// Never throws: a failed audit write is logged but does not undo the change it describes.
export async function audit(entry: AuditEntry): Promise<void> {
  try {
    await db()
      .insert(auditLog)
      .values({
        userId: entry.actor?.id ?? null,
        userEmail: entry.actor?.email.slice(0, 254) ?? null,
        action: entry.action,
        workspaceId: entry.workspaceId ?? null,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        details: entry.details ?? null,
      });
  } catch (error) {
    console.error("Failed to write audit log:", error instanceof Error ? error.message : error);
  }
}

export async function listAudit(limit = 200) {
  return db()
    .select({
      id: auditLog.id,
      at: auditLog.at,
      userEmail: auditLog.userEmail,
      action: auditLog.action,
      workspaceName: workspaces.name,
      targetType: auditLog.targetType,
      targetId: auditLog.targetId,
      details: auditLog.details,
    })
    .from(auditLog)
    .leftJoin(workspaces, eq(workspaces.id, auditLog.workspaceId))
    .orderBy(desc(auditLog.at))
    .limit(limit);
}

function pgCode(error: unknown): string | undefined {
  const source = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return (source as { code?: string } | null)?.code;
}
