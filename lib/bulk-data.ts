import "server-only";

import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { BulkRow } from "@/lib/bulk-parse";
import { getDb, type Db } from "@/lib/db";
import { bulkJobs, links } from "@/lib/db/schema";

function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

export async function insertBulkJob(input: {
  linkId: string;
  rows: BulkRow[];
  format: "png" | "svg";
  baseUrl: string;
  createdBy: string;
}): Promise<string> {
  const [row] = await db()
    .insert(bulkJobs)
    .values({ ...input, total: input.rows.length })
    .returning({ id: bulkJobs.id });
  return row.id;
}

// Leaves a job alone that already failed (with its own reason) or finished.
export async function markBulkJobFailed(id: string, error: string): Promise<void> {
  await db()
    .update(bulkJobs)
    .set({ status: "failed", error })
    .where(and(eq(bulkJobs.id, id), inArray(bulkJobs.status, ["queued", "running"])));
}

export type BulkJobSummary = {
  id: string;
  status: "queued" | "running" | "done" | "failed";
  format: "png" | "svg";
  total: number;
  processed: number;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
  expiresAt: string | null;
  hasZip: boolean;
};

// Never selects the zip itself.
export async function listBulkJobs(linkId: string, limit = 10): Promise<BulkJobSummary[]> {
  return db()
    .select({
      id: bulkJobs.id,
      status: bulkJobs.status,
      format: bulkJobs.format,
      total: bulkJobs.total,
      processed: bulkJobs.processed,
      error: bulkJobs.error,
      createdAt: bulkJobs.createdAt,
      finishedAt: bulkJobs.finishedAt,
      expiresAt: bulkJobs.expiresAt,
      hasZip: sql<boolean>`bulk_jobs.zip is not null`,
    })
    .from(bulkJobs)
    .where(eq(bulkJobs.linkId, linkId))
    .orderBy(desc(bulkJobs.createdAt))
    .limit(limit);
}

// The zip for a job, with the workspace of its link for the permission check.
export async function findBulkZip(jobId: string, slug: string) {
  const [row] = await db()
    .select({ zip: bulkJobs.zip, workspaceId: links.workspaceId, createdAt: bulkJobs.createdAt })
    .from(bulkJobs)
    .innerJoin(links, eq(links.id, bulkJobs.linkId))
    .where(and(eq(bulkJobs.id, jobId), eq(links.slug, slug)))
    .limit(1);
  return row ?? null;
}
