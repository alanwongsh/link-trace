"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  audit,
  countUsers,
  createFirstAdmin,
  createSession,
  deleteSession,
  deleteUserSessions,
  findUserByEmail,
  findUserById,
  normalizeEmail,
  updateUser,
} from "@/lib/accounts";
import {
  allowed,
  can,
  currentSessionToken,
  requireUser,
  sessionCookieOptions,
  type SessionUser,
} from "@/lib/auth";
import { deleteLink, findDestination, insertLink, moveLink, saveTags, saveTarget } from "@/lib/data";
import { hashPassword, passwordProblem, verifyAgainstDummy, verifyPassword } from "@/lib/password";
import { queueLabelledLinks } from "@/lib/bulk-queue";
import { parameterDefinitions } from "@/lib/parameter-data";
import { MAX_LABELLED_LINKS, planPlacements, submittedParameterLists, type ParameterValue } from "@/lib/parameters";
import { insertPlacement, linkHasPlacements } from "@/lib/placement-data";
import { SESSION_COOKIE, safeEqual } from "@/lib/session";
import {
  createSlug,
  MAX_TAGS,
  normalizePageHtml,
  normalizeSlug,
  normalizeUrl,
  parseTags,
} from "@/lib/slug";
import type { CreateState, EditState, FormState, LinkKind, TagState } from "@/lib/types";

const MAX_FAILED_LOGINS = 5;
const LOCK_MINUTES = 15;

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "");
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

function actor(user: SessionUser) {
  return { id: user.id, email: user.email };
}

async function startSession(userId: string): Promise<void> {
  const { token, maxAge } = await createSession(userId);
  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions(maxAge));
}

// ---- Sign in, sign out, setup, password ----

export async function login(_prev: FormState, formData: FormData): Promise<FormState> {
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  const password = String(formData.get("password") ?? "");
  const wrong: FormState = { error: "Wrong email or password.", ok: "" };
  if (!email || !password) return wrong;

  const user = await findUserByEmail(email);
  if (!user || !user.passwordHash || user.status !== "active") {
    await verifyAgainstDummy(password);
    await audit({ actor: null, action: "login.failed", details: { email } });
    return wrong;
  }

  if (user.lockedUntil && new Date(user.lockedUntil) > new Date()) {
    return { error: `Too many attempts. Try again after ${LOCK_MINUTES} minutes.`, ok: "" };
  }

  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLogins + 1;
    const lock = failed >= MAX_FAILED_LOGINS;
    await updateUser(user.id, {
      failedLogins: lock ? 0 : failed,
      lockedUntil: lock ? new Date(Date.now() + LOCK_MINUTES * 60_000).toISOString() : null,
    });
    await audit({ actor: { id: user.id, email }, action: lock ? "login.locked" : "login.failed" });
    return lock
      ? { error: `Too many attempts. Try again after ${LOCK_MINUTES} minutes.`, ok: "" }
      : wrong;
  }

  await updateUser(user.id, { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date().toISOString() });
  await startSession(user.id);
  await audit({ actor: { id: user.id, email }, action: "login" });
  redirect(user.mustChangePassword ? "/account" : safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  const token = await currentSessionToken();
  if (token) await deleteSession(token).catch(() => undefined);
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

// First run only: whoever knows ADMIN_PASSWORD creates the first org admin.
export async function setup(_prev: FormState, formData: FormData): Promise<FormState> {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) return { error: "Set ADMIN_PASSWORD on the server to finish setup.", ok: "" };
  if ((await countUsers()) > 0) redirect("/login");

  if (!safeEqual(String(formData.get("setup_password") ?? ""), adminPassword)) {
    return { error: "The setup password does not match ADMIN_PASSWORD.", ok: "" };
  }
  const email = normalizeEmail(String(formData.get("email") ?? ""));
  if (!email) return { error: "Enter a valid email.", ok: "" };
  const name = String(formData.get("name") ?? "").trim().slice(0, 80);
  if (!name) return { error: "Enter your name.", ok: "" };
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password);
  if (problem) return { error: problem, ok: "" };
  if (password !== String(formData.get("confirm") ?? "")) {
    return { error: "The passwords do not match.", ok: "" };
  }

  const created = await createFirstAdmin({ email, name, passwordHash: await hashPassword(password) });
  if (created === "already-set-up") redirect("/login");
  await audit({ actor: { id: created.id, email }, action: "setup.first_admin" });
  await startSession(created.id);
  redirect("/");
}

export async function changePassword(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser({ allowPasswordChange: true });
  const record = await findUserById(user.id);
  if (!record) redirect("/login");

  const current = String(formData.get("current") ?? "");
  if (!record.passwordHash || !(await verifyPassword(current, record.passwordHash))) {
    return { error: "Your current password is wrong.", ok: "" };
  }
  const next = String(formData.get("password") ?? "");
  const problem = passwordProblem(next);
  if (problem) return { error: problem, ok: "" };
  if (next !== String(formData.get("confirm") ?? "")) {
    return { error: "The new passwords do not match.", ok: "" };
  }
  if (next === current) return { error: "Choose a password different from the current one.", ok: "" };

  await updateUser(user.id, { passwordHash: await hashPassword(next), mustChangePassword: false });
  await deleteUserSessions(user.id, await currentSessionToken());
  await audit({ actor: actor(user), action: "user.password_changed", targetType: "user", targetId: user.id });
  if (record.mustChangePassword) redirect("/");
  return { error: "", ok: "Password changed. Other devices were signed out." };
}

// ---- Links ----

type Target = { kind: LinkKind; url: string | null; html: string | null };

function parseTarget(formData: FormData): ({ ok: true } & Target) | { ok: false; error: string } {
  if (formData.get("kind") === "page") {
    const page = normalizePageHtml(String(formData.get("html") ?? ""));
    if (!page.ok) return page;
    return { ok: true, kind: "page", url: null, html: page.html };
  }
  const url = normalizeUrl(String(formData.get("url") ?? ""));
  if (!url) return { ok: false, error: "Enter a full http or https URL." };
  return { ok: true, kind: "redirect", url, html: null };
}

const NO_PAGE_ROLE = "Only workspace owners can publish hosted pages.";

export async function createLink(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  const user = await requireUser();
  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (!can(user, workspaceId, "editor")) {
    return { error: "You cannot create links in that workspace.", slug: "" };
  }

  const target = parseTarget(formData);
  if (!target.ok) return { error: target.error, slug: "" };
  const { kind, url, html } = target;
  if (kind === "page" && !can(user, workspaceId, "owner")) return { error: NO_PAGE_ROLE, slug: "" };

  const titleRaw = String(formData.get("title") ?? "").trim();
  const title = titleRaw ? titleRaw.slice(0, 120) : null;
  const parsedTags = parseTags(String(formData.get("tags") ?? ""));
  if (!parsedTags.ok) return { error: parsedTags.error, slug: "" };
  const requested = String(formData.get("slug") ?? "");
  let slug = requested.trim() ? normalizeSlug(requested) : createSlug();

  if (!slug) {
    return {
      error: "Use 3–32 letters, numbers, and hyphens for the slug.",
      slug: "",
    };
  }

  // Optional placements, made when any value is picked (or a name is sent): one per combination of
  // the picked values. They are checked before the link is created, so a rejected value never
  // leaves a half-made link.
  const placementName = String(formData.get("placement_name") ?? "").trim();
  const submittedLists = submittedParameterLists(formData);
  const withPlacement = Boolean(placementName) || Object.values(submittedLists).some((list) => list.length > 0);
  const qrFormat = formData.get("qr_format") === "svg" ? "svg" : "png";
  let placementRows: ParameterValue[][] = [];
  if (withPlacement) {
    if (!allowed(user, workspaceId, "placements.manage")) {
      return { error: "You cannot add labelled links in that workspace.", slug: "" };
    }
    if (placementName.length > 80) return { error: "Keep the nickname under 80 characters.", slug: "" };
    const planned = planPlacements(await parameterDefinitions(workspaceId), submittedLists, MAX_LABELLED_LINKS);
    if (!planned.ok) return { error: "Check the highlighted labels.", slug: "", fieldErrors: planned.errors };
    placementRows = planned.rows;
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await insertLink({
      slug,
      kind,
      url,
      html,
      title,
      tags: parsedTags.tags,
      workspaceId,
      createdBy: user.id,
    });
    if (created.ok) {
      await audit({
        actor: actor(user),
        action: "link.create",
        workspaceId,
        targetType: "link",
        targetId: slug,
        details: { kind, url, htmlBytes: html?.length ?? null, tags: parsedTags.tags },
      });
      revalidatePath("/");
      if (!withPlacement) return { error: "", slug };

      // Several go through bulk jobs of up to 1,000, which also build their QR zips.
      if (placementRows.length > 1) {
        try {
          const jobIds = await queueLabelledLinks({
            linkId: created.data.id,
            rows: placementRows.map((values) => ({ name: placementName || null, values })),
            format: qrFormat,
            createdBy: user.id,
          });
          await audit({
            actor: actor(user),
            action: "placement.bulk_queued",
            workspaceId,
            targetType: "link",
            targetId: slug,
            details: { bulkJobIds: jobIds, rows: placementRows.length, format: qrFormat, from: "create-link" },
          });
          return { error: "", slug, queuedCount: placementRows.length };
        } catch (error) {
          console.error("Could not queue the first QR codes:", error instanceof Error ? error.message : error);
          return { error: "The link was created, but its labelled links were not. Add them on the link's page.", slug };
        }
      }

      const placementValues = placementRows[0] ?? [];
      try {
        const placement = await insertPlacement({
          linkId: created.data.id,
          name: placementName || null,
          values: placementValues,
          createdBy: user.id,
        });
        await audit({
          actor: actor(user),
          action: "placement.create",
          workspaceId,
          targetType: "placement",
          targetId: placement.code,
          details: { slug, name: placementName || null, values: Object.fromEntries(placementValues.map((v) => [v.key, v.value])) },
        });
        return { error: "", slug, placementCode: placement.code };
      } catch (error) {
        console.error("Could not create the first placement:", error instanceof Error ? error.message : error);
        return { error: "The link was created, but its labelled link was not. Add it on the link's page.", slug };
      }
    }
    if (created.message !== "That slug is already in use." || requested.trim()) {
      return { error: created.message, slug: "" };
    }
    slug = createSlug();
  }

  return { error: "Could not reserve a slug. Try again.", slug: "" };
}

// Loads a link and checks the user's role in its workspace.
async function linkForUser(rawSlug: FormDataEntryValue | null, min: "editor" | "owner") {
  const user = await requireUser();
  const slug = normalizeSlug(String(rawSlug ?? ""));
  if (!slug) return { ok: false, error: "That link could not be found." } as const;
  const found = await findDestination(slug);
  if (!found.ok) return { ok: false, error: found.message } as const;
  if (!found.data || !can(user, found.data.workspaceId, "viewer")) {
    return { ok: false, error: "That link could not be found." } as const;
  }
  if (!can(user, found.data.workspaceId, min)) {
    return { ok: false, error: `You need the ${min} role in this workspace to do that.` } as const;
  }
  return { ok: true, user, slug, link: found.data } as const;
}

export async function addTags(
  _prev: TagState,
  formData: FormData,
): Promise<TagState> {
  const loaded = await linkForUser(formData.get("slug"), "editor");
  if (!loaded.ok) return { error: loaded.error, added: "" };
  const { user, slug, link } = loaded;

  const parsed = parseTags(String(formData.get("tags") ?? ""));
  if (!parsed.ok) return { error: parsed.error, added: "" };
  if (parsed.tags.length === 0) {
    return { error: "Enter at least one tag, such as instagram.", added: "" };
  }

  const tags = [...link.tags];
  for (const tag of parsed.tags) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length === link.tags.length) {
    return { error: "Those tags are already on this link.", added: "" };
  }
  if (tags.length > MAX_TAGS) {
    return { error: `A link can have up to ${MAX_TAGS} tags.`, added: "" };
  }

  const saved = await saveTags(slug, tags, user.id);
  if (!saved.ok) return { error: saved.message, added: "" };
  await audit({
    actor: actor(user),
    action: "link.tags_added",
    workspaceId: link.workspaceId,
    targetType: "link",
    targetId: slug,
    details: { added: tags.filter((tag) => !link.tags.includes(tag)) },
  });
  revalidatePath("/");
  revalidatePath(`/stats/${slug}`);
  return { error: "", added: parsed.tags.join(",") };
}

export async function editTarget(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  const loaded = await linkForUser(formData.get("slug"), "owner");
  if (!loaded.ok) return { error: loaded.error, savedAt: 0 };
  const { user, slug, link } = loaded;

  const target = parseTarget(formData);
  if (!target.ok) return { error: target.error, savedAt: 0 };

  const saved = await saveTarget(slug, target, user.id);
  if (!saved.ok) return { error: saved.message, savedAt: 0 };
  if (!saved.data) return { error: "That link could not be found.", savedAt: 0 };
  await audit({
    actor: actor(user),
    action: "link.destination_changed",
    workspaceId: link.workspaceId,
    targetType: "link",
    targetId: slug,
    details: {
      from: { kind: link.kind, url: link.url, htmlBytes: link.html?.length ?? null },
      to: { kind: target.kind, url: target.url, htmlBytes: target.html?.length ?? null },
    },
  });
  revalidatePath("/");
  revalidatePath(`/stats/${slug}`);
  return { error: "", savedAt: Date.now() };
}

export async function moveLinkToWorkspace(_prev: FormState, formData: FormData): Promise<FormState> {
  const loaded = await linkForUser(formData.get("slug"), "owner");
  if (!loaded.ok) return { error: loaded.error, ok: "" };
  const { user, slug, link } = loaded;

  const workspaceId = String(formData.get("workspace_id") ?? "");
  if (workspaceId === link.workspaceId) return { error: "The link is already in that workspace.", ok: "" };
  if (!can(user, workspaceId, "owner")) {
    return { error: "You need the owner role in the workspace you move it to.", ok: "" };
  }
  // Placement labels use this workspace's parameters, which the other workspace does not have.
  if (await linkHasPlacements(link.id)) {
    return { error: "This link has labelled links with this workspace's labels, so it cannot be moved.", ok: "" };
  }

  const moved = await moveLink(slug, workspaceId, user.id);
  if (!moved.ok) return { error: moved.message, ok: "" };
  await audit({
    actor: actor(user),
    action: "link.moved",
    workspaceId,
    targetType: "link",
    targetId: slug,
    details: { fromWorkspaceId: link.workspaceId, toWorkspaceId: workspaceId },
  });
  revalidatePath("/");
  revalidatePath(`/stats/${slug}`);
  return { error: "", ok: "Moved." };
}

export async function removeLink(formData: FormData): Promise<void> {
  const loaded = await linkForUser(formData.get("slug"), "owner");
  if (!loaded.ok) redirect("/");
  const { user, slug, link } = loaded;
  await deleteLink(slug);
  await audit({
    actor: actor(user),
    action: "link.delete",
    workspaceId: link.workspaceId,
    targetType: "link",
    targetId: slug,
    details: { kind: link.kind, url: link.url },
  });
  redirect("/");
}
