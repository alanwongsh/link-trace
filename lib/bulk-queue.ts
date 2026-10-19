import "server-only";

import { after } from "next/server";
import { insertBulkJob, markBulkJobFailed } from "@/lib/bulk-data";
import { MAX_BULK_ROWS, type BulkRow } from "@/lib/bulk-parse";
import { appOrigin } from "@/lib/origin";
import { enqueue, jobsRunInline } from "@/lib/queue";

// Hands a saved bulk job to the queue after the response, so the page shows it straight away and
// follows its progress. With the inline queue this does the work here; with a worker queue it
// only hands it over.
export function queueBulkJob(jobId: string): void {
  after(async () => {
    try {
      // One job per upload, even if this were called twice.
      await enqueue("bulk-placements", { bulkJobId: jobId }, { singletonKey: jobId });
    } catch (error) {
      console.error("Bulk upload failed:", error instanceof Error ? error.message : error);
      // runBulkJob marks its own failures; this covers a queue that could not take the job.
      await markBulkJobFailed(jobId, "Could not be completed. Try again.").catch(() => {});
      return;
    }
    // Inline has no hourly schedule, so each upload also clears expired zips.
    if (jobsRunInline()) await enqueue("bulk-cleanup", {}).catch(() => {});
  });
}

// Saves and queues placements from picked values, in jobs of up to MAX_BULK_ROWS, each with its
// own zip. Returns the job ids in order.
export async function queueLabelledLinks(input: {
  linkId: string;
  rows: BulkRow[];
  format: "png" | "svg";
  createdBy: string;
}): Promise<string[]> {
  const baseUrl = await appOrigin();
  const jobIds: string[] = [];
  for (let start = 0; start < input.rows.length; start += MAX_BULK_ROWS) {
    const rows = input.rows.slice(start, start + MAX_BULK_ROWS);
    jobIds.push(await insertBulkJob({ linkId: input.linkId, rows, format: input.format, baseUrl, createdBy: input.createdBy }));
  }
  for (const jobId of jobIds) queueBulkJob(jobId);
  return jobIds;
}
