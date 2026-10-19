"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/accounts";
import { allowed, can, requireUser } from "@/lib/auth";
import { insertBulkJob, markBulkJobFailed } from "@/lib/bulk-data";
import { parseBulkCsv } from "@/lib/bulk-parse";
import { findDestination } from "@/lib/data";
import { appOrigin } from "@/lib/origin";
import { parameterDefinitions } from "@/lib/parameter-data";
import { enqueue } from "@/lib/queue";
import { normalizeSlug } from "@/lib/slug";
import type { BulkState } from "@/lib/types";

const MAX_CSV_BYTES = 512 * 1024;
const SHOWN_PROBLEMS = 20;

function failed(error: string): BulkState {
  return { error, checked: false, ready: 0, problems: [], problemCount: 0, sample: [], jobId: "" };
}

// intent "check" previews the CSV; "create" checks it again on the server and queues the job.
// The CSV is always re-read here, never taken from an earlier preview.
export async function bulkPlacements(_prev: BulkState, formData: FormData): Promise<BulkState> {
  const user = await requireUser();
  const slug = normalizeSlug(String(formData.get("slug") ?? ""));
  const found = slug ? await findDestination(slug) : null;
  if (!found?.ok) return failed(found ? found.message : "That link could not be found.");
  const link = found.data;
  if (!link || !can(user, link.workspaceId, "viewer")) return failed("That link could not be found.");
  if (!allowed(user, link.workspaceId, "placements.manage")) return failed("You cannot add placements in this workspace.");

  const csv = String(formData.get("csv") ?? "");
  if (!csv.trim()) return failed("Paste the CSV or load a file first.");
  if (new TextEncoder().encode(csv).length > MAX_CSV_BYTES) return failed("The CSV is over 512 KB. Split it into smaller files.");
  const format = formData.get("format") === "svg" ? "svg" : "png";

  const definitions = await parameterDefinitions(link.workspaceId);
  const names = new Map(definitions.map((d) => [d.key, d.name]));
  const parsed = parseBulkCsv(definitions, csv);
  const state: BulkState = {
    error: "",
    checked: true,
    ready: parsed.rows.length,
    problems: parsed.problems.slice(0, SHOWN_PROBLEMS),
    problemCount: parsed.problems.length,
    sample: parsed.rows.slice(0, 5).map((row) => [
      ...(row.name ? [`Name: ${row.name}`] : []),
      ...row.values.map((v) => `${names.get(v.key) ?? v.key}: ${v.value}`),
    ]),
    jobId: "",
  };
  if (formData.get("intent") !== "create" || parsed.problems.length) return state;

  const jobId = await insertBulkJob({
    linkId: link.id,
    rows: parsed.rows,
    format,
    baseUrl: await appOrigin(),
    createdBy: user.id,
  });
  try {
    // One queued job per upload, even if this were called twice.
    await enqueue("bulk-placements", { bulkJobId: jobId }, { singletonKey: jobId });
  } catch (error) {
    console.error("Could not queue the bulk upload:", error instanceof Error ? error.message : error);
    await markBulkJobFailed(jobId, "Could not be queued. Try again.");
    return { ...state, error: "The upload could not be queued. Try again shortly." };
  }
  await audit({
    actor: { id: user.id, email: user.email },
    action: "placement.bulk_queued",
    workspaceId: link.workspaceId,
    targetType: "link",
    targetId: slug!,
    details: { bulkJobId: jobId, rows: parsed.rows.length, format },
  });
  revalidatePath(`/stats/${slug}`);
  return { ...state, jobId };
}
