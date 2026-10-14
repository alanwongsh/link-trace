import "server-only";

import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { userForSession, type SessionUser } from "@/lib/accounts";
import { atLeast, type Role } from "@/lib/roles";
import { SESSION_COOKIE } from "@/lib/session";

export type { SessionUser };

// Once per request, however many components and checks ask for it.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await userForSession(token);
  } catch (error) {
    console.error("Session lookup failed:", error instanceof Error ? error.message : error);
    return null;
  }
});

// For pages and actions. A user with a temporary password is sent to change it first.
export async function requireUser(options: { allowPasswordChange?: boolean } = {}): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.mustChangePassword && !options.allowPasswordChange) redirect("/account");
  return user;
}

export async function requireOrgAdmin(): Promise<SessionUser> {
  const user = await requireUser();
  if (!user.isOrgAdmin) redirect("/");
  return user;
}

// Org admins act as owners everywhere.
export function roleIn(user: SessionUser, workspaceId: string): Role | null {
  if (user.isOrgAdmin) return "owner";
  return user.memberships.find((m) => m.workspaceId === workspaceId)?.role ?? null;
}

export function can(user: SessionUser, workspaceId: string, min: Role): boolean {
  return atLeast(roleIn(user, workspaceId), min);
}

export function sessionCookieOptions(maxAge: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    path: "/",
    secure: process.env.NODE_ENV === "production",
    maxAge,
  };
}

export async function currentSessionToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}
