"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  audit,
  countActiveOrgAdmins,
  deleteUserSessions,
  deleteWorkspace,
  findUserByEmail,
  findUserById,
  findWorkspace,
  insertUser,
  insertWorkspace,
  normalizeEmail,
  removeMembership,
  renameWorkspace,
  setMembership,
  updateUser,
  setWorkspaceTimezone,
} from "@/lib/accounts";
import { requireOrgAdmin, type SessionUser } from "@/lib/auth";
import { queueRebuild } from "@/lib/daily-totals";
import { hashPassword, passwordProblem } from "@/lib/password";
import { isRole } from "@/lib/roles";
import { isTimezone, timezoneLabel } from "@/lib/timezones";
import type { FormState } from "@/lib/types";

// Every action here is for org admins only.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function id(value: FormDataEntryValue | null): string | null {
  const text = String(value ?? "");
  return UUID.test(text) ? text : null;
}

function actor(user: SessionUser) {
  return { id: user.id, email: user.email };
}

function done(ok: string): FormState {
  return { error: "", ok };
}

function failed(error: string): FormState {
  return { error, ok: "" };
}

// ---- Users ----

export async function createUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) return failed("Enter a valid email.");
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return failed("Enter a name.");
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return failed(`Temporary password: ${problem}`);
  const isOrgAdmin = formData.get("is_org_admin") === "on";

  const created = await insertUser({
    email,
    name,
    passwordHash: await hashPassword(password),
    isOrgAdmin,
    mustChangePassword: true,
  });
  if (created === "duplicate") return failed("A user with that email already exists.");

  await audit({
    actor: actor(admin),
    action: "user.create",
    targetType: "user",
    targetId: created.id,
    details: { email, name, isOrgAdmin },
  });
  revalidatePath("/admin/users");
  redirect(`/admin/users/${created.id}`);
}

export async function renameUser(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const userId = id(formData.get("user_id"));
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!userId || !name) return failed("Enter a name.");
  await updateUser(userId, { name });
  await audit({ actor: actor(admin), action: "user.rename", targetType: "user", targetId: userId, details: { name } });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return done("Saved.");
}

export async function resetPassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const userId = id(formData.get("user_id"));
  if (!userId) return failed("User not found.");
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return failed(problem);

  await updateUser(userId, {
    passwordHash: await hashPassword(password),
    mustChangePassword: true,
    failedLogins: 0,
    lockedUntil: null,
  });
  await deleteUserSessions(userId);
  await audit({ actor: actor(admin), action: "user.password_reset", targetType: "user", targetId: userId });
  revalidatePath(`/admin/users/${userId}`);
  return done("Temporary password set. They must change it at next sign-in, and were signed out everywhere.");
}

export async function setUserStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const userId = id(formData.get("user_id"));
  const status = formData.get("status") === "disabled" ? "disabled" : "active";
  if (!userId) return failed("User not found.");
  if (userId === admin.id) return failed("You cannot disable your own account.");

  const target = await findUserById(userId);
  if (!target) return failed("User not found.");
  if (status === "disabled" && target.isOrgAdmin && (await countActiveOrgAdmins()) <= 1) {
    return failed("Keep at least one active org admin.");
  }

  await updateUser(userId, { status, failedLogins: 0, lockedUntil: null });
  if (status === "disabled") await deleteUserSessions(userId);
  await audit({
    actor: actor(admin),
    action: status === "disabled" ? "user.disable" : "user.enable",
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return done(status === "disabled" ? "Disabled and signed out." : "Enabled.");
}

export async function setOrgAdmin(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const userId = id(formData.get("user_id"));
  const isOrgAdmin = formData.get("is_org_admin") === "true";
  if (!userId) return failed("User not found.");
  if (userId === admin.id && !isOrgAdmin) return failed("You cannot remove your own org admin role.");
  if (!isOrgAdmin && (await countActiveOrgAdmins()) <= 1) return failed("Keep at least one active org admin.");

  await updateUser(userId, { isOrgAdmin });
  await audit({
    actor: actor(admin),
    action: isOrgAdmin ? "user.make_org_admin" : "user.remove_org_admin",
    targetType: "user",
    targetId: userId,
  });
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${userId}`);
  return done("Saved.");
}

// ---- Workspaces ----

function workspaceName(formData: FormData): string | null {
  const name = String(formData.get("name") ?? "").trim().replace(/\s+/g, " ").slice(0, 60);
  return name || null;
}

export async function createWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const name = workspaceName(formData);
  if (!name) return failed("Enter a workspace name.");
  const created = await insertWorkspace(name);
  if (created === "duplicate") return failed("A workspace with that name already exists.");
  await audit({ actor: actor(admin), action: "workspace.create", workspaceId: created.id, details: { name } });
  revalidatePath("/admin/workspaces");
  redirect(`/admin/workspaces/${created.id}`);
}

export async function updateWorkspaceName(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const workspaceId = id(formData.get("workspace_id"));
  const name = workspaceName(formData);
  if (!workspaceId || !name) return failed("Enter a workspace name.");
  if ((await renameWorkspace(workspaceId, name)) === "duplicate") {
    return failed("A workspace with that name already exists.");
  }
  await audit({ actor: actor(admin), action: "workspace.rename", workspaceId, details: { name } });
  revalidatePath("/admin/workspaces");
  revalidatePath(`/admin/workspaces/${workspaceId}`);
  return done("Saved.");
}

// The zone whose local midnight starts this workspace's report days. Changing it redoes the
// workspace's daily totals in the background, so past days move to the new boundaries.
export async function updateWorkspaceTimezone(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const workspaceId = id(formData.get("workspace_id"));
  const timezone = String(formData.get("timezone") ?? "").trim();
  if (!workspaceId) return failed("Workspace not found.");
  if (!isTimezone(timezone)) return failed("Choose a timezone from the list.");
  const workspace = await findWorkspace(workspaceId);
  if (!workspace) return failed("Workspace not found.");
  if (workspace.timezone === timezone) return done("Saved.");

  await setWorkspaceTimezone(workspaceId, timezone);
  queueRebuild({ workspaceId });
  await audit({
    actor: actor(admin),
    action: "workspace.timezone",
    workspaceId,
    details: { before: workspace.timezone, after: timezone },
  });
  revalidatePath(`/admin/workspaces/${workspaceId}`);
  return done(`Saved. Reports now count days in ${timezoneLabel(timezone)}; past days are being recounted.`);
}

export async function removeWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const workspaceId = id(formData.get("workspace_id"));
  if (!workspaceId) return failed("Workspace not found.");
  const workspace = await findWorkspace(workspaceId);
  if (!workspace) return failed("Workspace not found.");
  if ((await deleteWorkspace(workspaceId)) === "has-links") {
    return failed("Move or delete its links first. Workspaces with links cannot be deleted.");
  }
  await audit({ actor: actor(admin), action: "workspace.delete", details: { id: workspaceId, name: workspace.name } });
  revalidatePath("/admin/workspaces");
  redirect("/admin/workspaces");
}

export async function addMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const workspaceId = id(formData.get("workspace_id"));
  const role = formData.get("role");
  if (!workspaceId || !isRole(role)) return failed("Choose a workspace and a role.");

  // Either a user id (from a user's page) or an email (from a workspace's page).
  let userId = id(formData.get("user_id"));
  if (!userId) {
    const email = normalizeEmail(String(formData.get("email") ?? ""));
    if (!email) return failed("Enter the email of an existing user.");
    const user = await findUserByEmail(email);
    if (!user) return failed("No user has that email. Add them under Users first.");
    userId = user.id;
  }

  await setMembership(workspaceId, userId, role);
  await audit({
    actor: actor(admin),
    action: "membership.set",
    workspaceId,
    targetType: "user",
    targetId: userId,
    details: { role },
  });
  revalidatePath(`/admin/workspaces/${workspaceId}`);
  revalidatePath(`/admin/users/${userId}`);
  return done("Saved.");
}

export async function removeMember(_prev: FormState, formData: FormData): Promise<FormState> {
  const admin = await requireOrgAdmin();
  const workspaceId = id(formData.get("workspace_id"));
  const userId = id(formData.get("user_id"));
  if (!workspaceId || !userId) return failed("Member not found.");
  await removeMembership(workspaceId, userId);
  await audit({ actor: actor(admin), action: "membership.remove", workspaceId, targetType: "user", targetId: userId });
  revalidatePath(`/admin/workspaces/${workspaceId}`);
  revalidatePath(`/admin/users/${userId}`);
  return done("Removed.");
}
