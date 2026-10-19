import { eq } from "drizzle-orm";
import { strFromU8, unzipSync } from "fflate";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/accounts";
import { removeExpiredZips, runBulkJob } from "@/lib/bulk-job";
import { parseBulkCsv } from "@/lib/bulk-parse";
import { parseCsv, toCsv } from "@/lib/csv";
import { bulkJobs, links, placements, trackingParameters } from "@/lib/db/schema";
import type { ParameterDefinition } from "@/lib/parameters";
import { jobHandlers } from "@/lib/jobs/handlers";
import { PgBossDriver } from "@/lib/jobs/pgboss-driver";
import { createUser, createWorkspace, db, form, resetData } from "./helpers";
import { testDatabaseUrl } from "./test-db";

const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireUser: async () => {
      if (!session.user) throw new Error("not signed in");
      return session.user;
    },
    getCurrentUser: async () => session.user,
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/origin", () => ({ appOrigin: async () => "https://lt.example" }));
const queued = vi.hoisted(() => [] as string[]);
vi.mock("@/lib/queue", () => ({
  enqueue: async (name: string, data: { bulkJobId: string }) => void queued.push(`${name}:${data.bulkJobId}`),
  jobsRunInline: () => false,
}));
// after() needs a Next.js request scope; run the task straight away instead.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: async (task: () => unknown) => void (await task()) };
});

const { bulkPlacements } = await import("@/lib/bulk-actions");
const { createParameter, importOptions } = await import("@/lib/parameter-actions");
const { listPlacements } = await import("@/lib/placement-data");
const { GET: downloadZip } = await import("@/app/stats/[slug]/bulk/[jobId]/route");
const { GET: downloadTemplate } = await import("@/app/stats/[slug]/bulk/template/route");

const sql = postgres(testDatabaseUrl(), { max: 2, onnotice: () => {} });
afterAll(() => sql.end());

describe("CSV", () => {
  it("reads quotes, commas and line breaks in quoted fields, and skips blank lines", () => {
    expect(parseCsv('﻿name,store\r\n"Gurney, Penang",PG002\n\n"say ""hi""\nthere",KL001\n')).toEqual([
      ["name", "store"],
      ["Gurney, Penang", "PG002"],
      ['say "hi"\nthere', "KL001"],
    ]);
  });

  it("writes CSV that spreadsheets will not run as formulas", () => {
    expect(toCsv([["a,b", "=SUM(A1)", 'x"y']])).toBe('"a,b",\'=SUM(A1),"x""y"\r\n');
  });
});

describe("checking a bulk upload", () => {
  const definitions: ParameterDefinition[] = [
    {
      id: "p1",
      key: "store_code",
      name: "Store",
      fieldType: "dropdown",
      isRequired: true,
      isActive: true,
      options: [
        { id: "o1", value: "KL001", isActive: true },
        { id: "o2", value: "OLD", isActive: false },
      ],
    },
    { id: "p2", key: "booth", name: "Booth", fieldType: "text", isRequired: false, isActive: true, options: [] },
  ];

  it("turns each row into one placement, matching columns in any order and case", () => {
    const result = parseBulkCsv(definitions, "Booth,STORE_CODE,Name\nB1,kl001,Door\n,KL001,");
    expect(result.problems).toEqual([]);
    expect(result.rows).toEqual([
      { name: "Door", values: [{ parameterId: "p1", key: "store_code", value: "KL001", optionId: "o1" }, { parameterId: "p2", key: "booth", value: "B1", optionId: null }] },
      { name: null, values: [{ parameterId: "p1", key: "store_code", value: "KL001", optionId: "o1" }] },
    ]);
  });

  it("reports unknown and missing required columns before reading rows", () => {
    expect(parseBulkCsv(definitions, "booth,colour\nB1,red").problems.map((p) => p.message)).toEqual([
      "colour is not an active parameter in this workspace.",
      "The required column store_code (Store) is missing.",
    ]);
  });

  it("reports bad rows by line number", () => {
    const result = parseBulkCsv(definitions, "store_code,booth\nKL001,B1\nOLD,B2\n,B3\nKL001,B4,extra");
    expect(result.rows).toHaveLength(1);
    expect(result.problems).toEqual([
      { line: 3, message: '"OLD" is not an option for Store.' },
      { line: 4, message: "Store is required." },
      { line: 5, message: "Has 3 columns; the header has 2." },
    ]);
  });

  it("limits the number of rows", () => {
    const csv = ["store_code", ...Array.from({ length: 1001 }, () => "KL001")].join("\n");
    expect(parseBulkCsv(definitions, csv).problems[0].message).toBe("Upload up to 1000 rows at a time.");
  });
});

describe("bulk uploads", () => {
  let workspaceId: string;
  let otherWorkspaceId: string;
  let linkId: string;
  const empty = { error: "", checked: false, ready: 0, problems: [], problemCount: 0, sample: [], jobId: "" };

  beforeEach(async () => {
    await resetData();
    queued.length = 0;
    workspaceId = await createWorkspace();
    otherWorkspaceId = await createWorkspace();
    session.user = await createUser({ [workspaceId]: "editor" });
    [{ id: linkId }] = await db()
      .insert(links)
      .values({ slug: "promo", url: "https://example.com", workspaceId })
      .returning({ id: links.id });
    await createParameter(
      { error: "", ok: "" },
      form({ workspace_id: workspaceId, name: "Store", key: "store_code", field_type: "dropdown", is_required: "on" }),
    );
    const [param] = await db().select().from(trackingParameters).where(eq(trackingParameters.key, "store_code"));
    await importOptions({ error: "", ok: "" }, form({ parameter_id: param.id, options: "KL001,Mid Valley\nPG002,Gurney" }));
  });

  const csv = "name,store_code\nDoor,KL001\nTill,PG002\n,KL001";

  async function queue() {
    const result = await bulkPlacements(empty, form({ slug: "promo", csv, intent: "create" }));
    expect(result.error).toBe("");
    return result.jobId;
  }

  it("checks without creating anything", async () => {
    const result = await bulkPlacements(empty, form({ slug: "promo", csv, intent: "check" }));
    expect(result).toMatchObject({ checked: true, ready: 3, problemCount: 0, jobId: "" });
    expect(result.sample[0]).toEqual(["Name: Door", "Store: KL001"]);
    expect(await db().select().from(bulkJobs)).toEqual([]);
    expect(queued).toEqual([]);
  });

  it("does not queue a file with problems", async () => {
    const result = await bulkPlacements(empty, form({ slug: "promo", csv: "store_code\nZZ9", intent: "create" }));
    expect(result).toMatchObject({ problemCount: 1, jobId: "" });
    expect(await db().select().from(bulkJobs)).toEqual([]);
  });

  it("queues a clean file, then the job makes the placements and a zip", async () => {
    const jobId = await queue();
    expect(queued).toEqual([`bulk-placements:${jobId}`]);
    expect(await listPlacements(linkId)).toEqual([]);

    expect(await runBulkJob(sql, jobId)).toBe("done");
    const made = await listPlacements(linkId);
    expect(made.map((p) => [p.name, p.values.map((v) => v.value)])).toEqual([
      ["Door", ["KL001"]],
      ["Till", ["PG002"]],
      [null, ["KL001"]],
    ]);

    const [job] = await db().select().from(bulkJobs);
    expect(job).toMatchObject({ status: "done", processed: 3, total: 3 });
    const files = unzipSync(new Uint8Array(job.zip!));
    const names = Object.keys(files).sort();
    expect(names).toHaveLength(4);
    expect(names.filter((n) => n.endsWith(".png"))).toHaveLength(3);
    expect(names.find((n) => n.endsWith(".png"))).toMatch(/^1-[a-z0-9]{8}-door-kl001\.png$/);
    const mapping = parseCsv(strFromU8(files["placements.csv"]));
    expect(mapping[0]).toEqual(["file", "code", "url", "name", "store_code", "store_code_label"]);
    expect(mapping[1].slice(2)).toEqual([`https://lt.example/q/${made[0].code}`, "Door", "KL001", "Mid Valley"]);
  });

  it("does not duplicate placements when a job runs again", async () => {
    const jobId = await queue();
    await runBulkJob(sql, jobId);
    expect(await runBulkJob(sql, jobId)).toBe("skipped");
    // A retry after a failure part-way reuses what was made.
    await db().update(bulkJobs).set({ status: "running", zip: null }).where(eq(bulkJobs.id, jobId));
    expect(await runBulkJob(sql, jobId)).toBe("done");
    expect(await db().select().from(placements)).toHaveLength(3);
  });

  it("makes SVG files when asked", async () => {
    const result = await bulkPlacements(empty, form({ slug: "promo", csv, intent: "create", format: "svg" }));
    await runBulkJob(sql, result.jobId);
    const [job] = await db().select().from(bulkJobs);
    const files = unzipSync(new Uint8Array(job.zip!));
    const svg = Object.keys(files).find((n) => n.endsWith(".svg"))!;
    expect(strFromU8(files[svg])).toContain("<svg");
  });

  it("needs the right role and hides other workspaces' links", async () => {
    session.user = await createUser({ [workspaceId]: "viewer" });
    expect((await bulkPlacements(empty, form({ slug: "promo", csv, intent: "check" }))).error).toBe(
      "You cannot add placements in this workspace.",
    );
    session.user = await createUser({ [otherWorkspaceId]: "owner" });
    expect((await bulkPlacements(empty, form({ slug: "promo", csv, intent: "check" }))).error).toBe(
      "That link could not be found.",
    );
  });

  it("serves the zip only to people who can see the link, and stops after it expires", async () => {
    const jobId = await queue();
    const request = () => new NextRequest(`http://localhost/stats/promo/bulk/${jobId}`);
    const params = { params: Promise.resolve({ slug: "promo", jobId }) };
    expect((await downloadZip(request(), params)).status).toBe(410);

    await runBulkJob(sql, jobId);
    const ok = await downloadZip(request(), params);
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/zip");

    session.user = await createUser({ [otherWorkspaceId]: "owner" });
    expect((await downloadZip(request(), params)).status).toBe(404);

    await db().update(bulkJobs).set({ expiresAt: "2000-01-01T00:00:00Z" }).where(eq(bulkJobs.id, jobId));
    expect(await removeExpiredZips(sql)).toBe(1);
    session.user = await createUser({ [workspaceId]: "viewer" });
    expect((await downloadZip(request(), params)).status).toBe(410);
    expect(await db().select().from(placements)).toHaveLength(3);
  });

  it("offers a template with the workspace's parameter keys", async () => {
    const response = await downloadTemplate(new NextRequest("http://localhost/stats/promo/bulk/template"), {
      params: Promise.resolve({ slug: "promo" }),
    });
    expect(parseCsv(await response.text())).toEqual([
      ["name", "store_code"],
      ["Entrance poster", "KL001"],
    ]);
  });

  it("runs end to end through the real queue and the worker's handlers", { timeout: 60_000 }, async () => {
    const jobId = await queue();
    const driver = new PgBossDriver(testDatabaseUrl(), "worker", { pollingIntervalSeconds: 0.5 });
    await driver.start();
    try {
      const handlers = jobHandlers(sql, () => {});
      const done = new Promise<void>((resolve, reject) => {
        void driver.work("bulk-placements", async (jobs) => {
          try {
            await handlers["bulk-placements"](jobs);
            resolve();
          } catch (error) {
            reject(error);
          }
        });
      });
      await driver.send("bulk-placements", { bulkJobId: jobId }, { singletonKey: jobId });
      await done;
      const [job] = await db().select({ status: bulkJobs.status }).from(bulkJobs);
      expect(job.status).toBe("done");
    } finally {
      await driver.stop();
    }
  });
});
