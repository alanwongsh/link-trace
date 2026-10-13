"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession, sessionCookieOptions } from "@/lib/auth";
import { deleteLink, findDestination, insertLink, saveTags, saveTarget } from "@/lib/data";
import {
  createSlug,
  MAX_TAGS,
  normalizePageHtml,
  normalizeSlug,
  normalizeUrl,
  parseTags,
} from "@/lib/slug";
import {
  SESSION_COOKIE,
  passwordMatches,
  expectedSessionToken,
} from "@/lib/session";
import type { CreateState, EditState, LinkKind, TagState } from "@/lib/types";

function safeNext(value: FormDataEntryValue | null): string {
  const next = String(value ?? "");
  if (next.startsWith("/") && !next.startsWith("//")) return next;
  return "/";
}

export async function login(
  _prev: { error: string },
  formData: FormData,
): Promise<{ error: string }> {
  if (!process.env.ADMIN_PASSWORD) {
    return { error: "Set ADMIN_PASSWORD before signing in." };
  }

  const password = String(formData.get("password") ?? "");
  if (!(await passwordMatches(password))) {
    return { error: "Wrong password." };
  }

  const token = await expectedSessionToken();
  if (!token) return { error: "Set ADMIN_PASSWORD before signing in." };

  (await cookies()).set(SESSION_COOKIE, token, sessionCookieOptions());
  redirect(safeNext(formData.get("next")));
}

export async function logout(): Promise<void> {
  (await cookies()).delete(SESSION_COOKIE);
  redirect("/login");
}

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

export async function createLink(
  _prev: CreateState,
  formData: FormData,
): Promise<CreateState> {
  await requireSession();

  const target = parseTarget(formData);
  if (!target.ok) return { error: target.error, slug: "" };
  const { kind, url, html } = target;

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

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const created = await insertLink({ slug, kind, url, html, title, tags: parsedTags.tags });
    if (created.ok) {
      revalidatePath("/");
      return { error: "", slug };
    }
    if (created.message !== "That slug is already in use." || requested.trim()) {
      return { error: created.message, slug: "" };
    }
    slug = createSlug();
  }

  return { error: "Could not reserve a slug. Try again.", slug: "" };
}

export async function addTags(
  _prev: TagState,
  formData: FormData,
): Promise<TagState> {
  await requireSession();
  const slug = normalizeSlug(String(formData.get("slug") ?? ""));
  if (!slug) return { error: "That link could not be found.", added: "" };

  const parsed = parseTags(String(formData.get("tags") ?? ""));
  if (!parsed.ok) return { error: parsed.error, added: "" };
  if (parsed.tags.length === 0) {
    return { error: "Enter at least one tag, such as instagram.", added: "" };
  }

  const existing = await findDestination(slug);
  if (!existing.ok) return { error: existing.message, added: "" };
  if (!existing.data) return { error: "That link could not be found.", added: "" };

  const tags = [...existing.data.tags];
  for (const tag of parsed.tags) {
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length === existing.data.tags.length) {
    return { error: "Those tags are already on this link.", added: "" };
  }
  if (tags.length > MAX_TAGS) {
    return { error: `A link can have up to ${MAX_TAGS} tags.`, added: "" };
  }

  const saved = await saveTags(slug, tags);
  if (!saved.ok) return { error: saved.message, added: "" };
  revalidatePath("/");
  revalidatePath(`/stats/${slug}`);
  return { error: "", added: parsed.tags.join(",") };
}

export async function editTarget(
  _prev: EditState,
  formData: FormData,
): Promise<EditState> {
  await requireSession();
  const slug = normalizeSlug(String(formData.get("slug") ?? ""));
  if (!slug) return { error: "That link could not be found.", savedAt: 0 };

  const target = parseTarget(formData);
  if (!target.ok) return { error: target.error, savedAt: 0 };

  const saved = await saveTarget(slug, target);
  if (!saved.ok) return { error: saved.message, savedAt: 0 };
  if (!saved.data) return { error: "That link could not be found.", savedAt: 0 };
  revalidatePath("/");
  revalidatePath(`/stats/${slug}`);
  return { error: "", savedAt: Date.now() };
}

export async function removeLink(formData: FormData): Promise<void> {
  await requireSession();
  const slug = String(formData.get("slug") ?? "");
  if (!/^[a-z0-9-]{3,32}$/.test(slug)) redirect("/");
  await deleteLink(slug);
  redirect("/");
}
