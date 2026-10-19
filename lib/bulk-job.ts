// The work behind one bulk upload: create its placements, then build a zip of their QR codes
// with a placements.csv mapping each code to its address and labels. Run by scripts/worker.ts.
// Plain SQL with relative imports only, so Node can run it without the app's build.
import { zipSync, strToU8 } from "fflate";
import type { Sql } from "postgres";
import QRCode from "qrcode";
import { toCsv } from "./csv.ts";
import { createSlug } from "./slug.ts";

export const ZIP_DAYS = 7;

type StoredRow = { name: string | null; values: { parameterId: string; key: string; value: string; optionId: string | null }[] };

type JobRow = {
  id: string;
  link_id: string;
  status: string;
  format: "png" | "svg";
  rows: StoredRow[];
  base_url: string;
  slug: string;
};

const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 2, color: { dark: "#000000", light: "#ffffff" } } as const;

function fileLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

// Safe to run more than once for the same job: placements already made for it are reused, and a
// finished job is left alone. onProgress is called as QR codes are drawn.
export async function runBulkJob(
  sql: Sql,
  jobId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<"done" | "skipped"> {
  const [job] = await sql<JobRow[]>`
    update bulk_jobs b set status = 'running', started_at = coalesce(b.started_at, now()), error = null
    from links l
    where b.id = ${jobId} and l.id = b.link_id and b.status <> 'done'
    returning b.id, b.link_id, b.status, b.format, b.rows, b.base_url, l.slug`;
  if (!job) return "skipped";

  try {
    const placements = await sql.begin(async (tx) => {
      // Locks the job so two workers cannot create its placements twice.
      await tx`select id from bulk_jobs where id = ${jobId} for update`;
      const existing = await tx<{ id: string }[]>`select id from placements where bulk_job_id = ${jobId} limit 1`;
      if (existing.length === 0) {
        for (const row of job.rows) {
          let placementId: string | undefined;
          while (!placementId) {
            const inserted = await tx<{ id: string }[]>`
              insert into placements (link_id, code, name, bulk_job_id, created_by)
              select ${job.link_id}, ${createSlug(8)}, ${row.name}, ${jobId}, created_by from bulk_jobs where id = ${jobId}
              on conflict (code) do nothing returning id`;
            placementId = inserted[0]?.id;
          }
          if (row.values.length) {
            await tx`insert into placement_values ${tx(
              row.values.map((v) => ({ placement_id: placementId!, parameter_id: v.parameterId, option_id: v.optionId, value: v.value })),
            )}`;
          }
        }
      }
      return tx<{ id: string; code: string; name: string | null }[]>`
        select id, code, name from placements where bulk_job_id = ${jobId} order by created_at, id`;
    });

    const values = await sql<{ placement_id: string; key: string; value: string; label: string | null }[]>`
      select v.placement_id, t.key, v.value, o.label
      from placement_values v
      join placements p on p.id = v.placement_id
      join tracking_parameters t on t.id = v.parameter_id
      left join tracking_parameter_options o on o.id = v.option_id
      where p.bulk_job_id = ${jobId}
      order by t.sort_order, t.created_at`;
    const keys = [...new Set(values.map((v) => v.key))];
    const byPlacement = new Map<string, Map<string, { value: string; label: string | null }>>();
    for (const v of values) {
      if (!byPlacement.has(v.placement_id)) byPlacement.set(v.placement_id, new Map());
      byPlacement.get(v.placement_id)!.set(v.key, v);
    }

    const files: Record<string, Uint8Array> = {};
    const mapping: string[][] = [["file", "code", "url", "name", ...keys.flatMap((k) => [k, `${k}_label`])]];
    const width = String(placements.length).length;
    for (const [index, placement] of placements.entries()) {
      const url = `${job.base_url}/q/${placement.code}`;
      const own = byPlacement.get(placement.id) ?? new Map();
      const label = fileLabel([placement.name ?? "", ...keys.map((k) => own.get(k)?.value ?? "")].filter(Boolean).join(" "));
      const file = `${String(index + 1).padStart(width, "0")}-${placement.code}${label ? `-${label}` : ""}.${job.format}`;
      files[file] =
        job.format === "png"
          ? new Uint8Array(await QRCode.toBuffer(url, { ...QR_OPTIONS, type: "png", width: 1024 }))
          : strToU8(await QRCode.toString(url, { ...QR_OPTIONS, type: "svg" }));
      mapping.push([
        file,
        placement.code,
        url,
        placement.name ?? "",
        ...keys.flatMap((k) => [own.get(k)?.value ?? "", own.get(k)?.label ?? ""]),
      ]);
      if ((index + 1) % 25 === 0 || index + 1 === placements.length) {
        await sql`update bulk_jobs set processed = ${index + 1} where id = ${jobId}`;
        onProgress?.(index + 1, placements.length);
      }
    }
    files["placements.csv"] = strToU8(toCsv(mapping));
    // PNGs are already compressed; level 0 only stores them.
    const zip = zipSync(files, { level: job.format === "png" ? 0 : 6 });

    await sql`
      update bulk_jobs set status = 'done', zip = ${Buffer.from(zip)}, processed = ${placements.length},
        finished_at = now(), expires_at = now() + make_interval(days => ${ZIP_DAYS})
      where id = ${jobId}`;
    await sql`
      insert into audit_log (user_id, action, workspace_id, target_type, target_id, details)
      select b.created_by, 'placement.bulk_create', l.workspace_id, 'link', l.slug,
        ${JSON.stringify({ bulkJobId: jobId, placements: placements.length, format: job.format })}::text::jsonb
      from bulk_jobs b join links l on l.id = b.link_id where b.id = ${jobId}`;
    return "done";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await sql`update bulk_jobs set status = 'failed', error = ${message.slice(0, 500)} where id = ${jobId}`;
    throw error;
  }
}

// Drops zips past their expiry; the placements and the job record stay.
export async function removeExpiredZips(sql: Sql): Promise<number> {
  const result = await sql`update bulk_jobs set zip = null where zip is not null and expires_at < now()`;
  return result.count;
}
