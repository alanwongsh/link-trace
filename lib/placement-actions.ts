"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/accounts";
import { allowed, can, requireUser, type SessionUser } from "@/lib/auth";
import { findDestination } from "@/lib/data";
import { parameterDefinitions } from "@/lib/parameter-data";
import { submittedParameterValues, validateParameterValues } from "@/lib/parameters";
import { findPlacement, insertPlacement, setPlacementActive } from "@/lib/placement-data";
import { normalizeSlug } from "@/lib/slug";
import type { FormState, PlacementState } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(user: SessionUser) {
  return { id: user.id, email: user.email };
}

function failed(error: string, fieldErrors: Record<string, string> = {}): PlacementState {
  return { error, fieldErrors, code: "" };
}

export async function createPlacement(_prev: PlacementState, formData: FormData): Promise<PlacementState> {
  const user = await requireUser();
  const slug = normalizeSlug(String(formData.get("slug") ?? ""));
  const found = slug ? await findDestination(slug) : null;
  if (!found?.ok) return failed(found ? found.message : "That link could not be found.");
  const link = found.data;
  // Links in other workspaces look the same as missing ones.
  if (!link || !can(user, link.workspaceId, "viewer")) {
    return failed("That link could not be found.");
  }
  if (!allowed(user, link.workspaceId, "placements.manage")) {
    return failed("You cannot add placements in this workspace.");
  }

  const rawName = String(formData.get("name") ?? "").trim();
  if (rawName.length > 80) return failed("Keep the name under 80 characters.");

  // The workspace comes from the link, never from the form.
  const definitions = await parameterDefinitions(link.workspaceId);
  const checked = validateParameterValues(definitions, submittedParameterValues(formData));
  if (!checked.ok) return failed("Check the highlighted fields.", checked.errors);

  const created = await insertPlacement({
    linkId: link.id,
    name: rawName || null,
    values: checked.values,
    createdBy: user.id,
  });
  await audit({
    actor: actor(user),
    action: "placement.create",
    workspaceId: link.workspaceId,
    targetType: "placement",
    targetId: created.code,
    details: { slug, name: rawName || null, values: Object.fromEntries(checked.values.map((v) => [v.key, v.value])) },
  });
  revalidatePath(`/stats/${slug}`);
  return { error: "", fieldErrors: {}, code: created.code };
}

export async function setPlacementStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("placement_id") ?? "");
  const placement = UUID.test(id) ? await findPlacement(id) : null;
  if (!placement || !allowed(user, placement.workspaceId, "placements.manage")) {
    return { error: "That placement could not be found.", ok: "" };
  }

  const isActive = formData.get("is_active") === "true";
  await setPlacementActive(placement.id, isActive, user.id);
  await audit({
    actor: actor(user),
    action: isActive ? "placement.activate" : "placement.deactivate",
    workspaceId: placement.workspaceId,
    targetType: "placement",
    targetId: placement.code,
    details: { slug: placement.slug },
  });
  revalidatePath(`/stats/${placement.slug}`);
  return { error: "", ok: isActive ? "Active." : "Inactive. Its code still redirects." };
}
