"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/accounts";
import { allowed, can, requireUser, type SessionUser } from "@/lib/auth";
import { queueLabelledLinks } from "@/lib/bulk-queue";
import { findDestination } from "@/lib/data";
import { parameterDefinitions } from "@/lib/parameter-data";
import { MAX_LABELLED_LINKS, planPlacements, submittedParameterLists } from "@/lib/parameters";
import { DuplicateLabels, findPlacement, insertPlacement, setPlacementActive, withoutExisting } from "@/lib/placement-data";
import { normalizeSlug } from "@/lib/slug";
import type { FormState, PlacementState } from "@/lib/types";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function actor(user: SessionUser) {
  return { id: user.id, email: user.email };
}

function duplicateMessage(code: string | null): string {
  return code
    ? `A labelled link with these labels already exists: /q/${code}. Deactivate it first to replace it.`
    : "A labelled link with these labels already exists. Deactivate it first to replace it.";
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
    return failed("You cannot add labelled links in this workspace.");
  }

  const rawName = String(formData.get("name") ?? "").trim();
  if (rawName.length > 80) return failed("Keep the nickname under 80 characters.");

  // The workspace comes from the link, never from the form.
  const definitions = await parameterDefinitions(link.workspaceId);
  const planned = planPlacements(definitions, submittedParameterLists(formData), MAX_LABELLED_LINKS);
  if (!planned.ok) return failed("Check the highlighted fields.", planned.errors);

  // One active labelled link per set of labels: the ones that already exist are left out.
  const { fresh, existing } = await withoutExisting(link.id, planned.rows.map((values) => ({ name: rawName || null, values })));
  const skippedCount = existing.length;
  if (fresh.length === 0) {
    return failed(
      planned.rows.length === 1 && existing[0]?.code
        ? duplicateMessage(existing[0].code)
        : `All ${planned.rows.length.toLocaleString("en")} already exist, so there is nothing to add.`,
    );
  }

  // Several go through bulk jobs of up to 1,000, which also build their QR zips.
  if (fresh.length > 1) {
    const format = formData.get("qr_format") === "svg" ? "svg" : "png";
    const jobIds = await queueLabelledLinks({
      linkId: link.id,
      rows: fresh.map(({ values }) => ({ name: rawName || null, values })),
      format,
      createdBy: user.id,
    });
    await audit({
      actor: actor(user),
      action: "placement.bulk_queued",
      workspaceId: link.workspaceId,
      targetType: "link",
      targetId: slug!,
      details: { bulkJobIds: jobIds, rows: fresh.length, skipped: skippedCount, format, from: "placement-form" },
    });
    revalidatePath(`/stats/${slug}`);
    return { error: "", fieldErrors: {}, code: "", queuedCount: fresh.length, queuedJobId: jobIds[0], skippedCount };
  }

  const values = fresh[0].values;
  let created: { id: string; code: string };
  try {
    created = await insertPlacement({ linkId: link.id, name: rawName || null, values, createdBy: user.id });
  } catch (error) {
    // Someone added the same labels a moment ago; the database refused the second one.
    if (error instanceof DuplicateLabels) return failed(duplicateMessage(error.code));
    throw error;
  }
  await audit({
    actor: actor(user),
    action: "placement.create",
    workspaceId: link.workspaceId,
    targetType: "placement",
    targetId: created.code,
    details: { slug, name: rawName || null, values: Object.fromEntries(values.map((v) => [v.key, v.value])) },
  });
  revalidatePath(`/stats/${slug}`);
  return { error: "", fieldErrors: {}, code: created.code, skippedCount };
}

export async function setPlacementStatus(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const id = String(formData.get("placement_id") ?? "");
  const placement = UUID.test(id) ? await findPlacement(id) : null;
  if (!placement || !allowed(user, placement.workspaceId, "placements.manage")) {
    return { error: "That labelled link could not be found.", ok: "" };
  }

  const isActive = formData.get("is_active") === "true";
  try {
    await setPlacementActive(placement.id, isActive, user.id);
  } catch (error) {
    if (error instanceof DuplicateLabels) {
      return {
        error: `It cannot be activated: ${error.code ? `/q/${error.code}` : "another active labelled link"} has the same labels. Deactivate that one first.`,
        ok: "",
      };
    }
    throw error;
  }
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
