import { eq } from "drizzle-orm";
import { unzipSync } from "fflate";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/accounts";
import { bulkJobs, links, trackingParameters } from "@/lib/db/schema";
import { createUser, createWorkspace, db, form, resetData } from "./helpers";

// The default queue (inline) with nothing mocked but sign-in: a bulk upload finishes by itself,
// with no worker, as it would on Vercel.
const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return {
    ...actual,
    after: (task: unknown) => {
      pending.push(Promise.resolve(typeof task === "function" ? task() : task));
    },
  };
});
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, requireUser: async () => session.user! };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/origin", () => ({ appOrigin: async () => "https://lt.example" }));

const { bulkPlacements } = await import("@/lib/bulk-actions");
const { createParameter, importOptions } = await import("@/lib/parameter-actions");
const { listPlacements } = await import("@/lib/placement-data");

describe("inline queue (default)", () => {
  beforeEach(async () => {
    await resetData();
    delete process.env.QUEUE_DRIVER;
  });

  it("finishes a bulk upload after the response, with no worker", async () => {
    const workspaceId = await createWorkspace();
    session.user = await createUser({ [workspaceId]: "editor" });
    const [{ id: linkId }] = await db()
      .insert(links)
      .values({ slug: "promo", url: "https://example.com", workspaceId })
      .returning({ id: links.id });
    await createParameter(
      { error: "", ok: "" },
      form({ workspace_id: workspaceId, name: "Store", key: "store_code", field_type: "dropdown" }),
    );
    const [param] = await db().select().from(trackingParameters).where(eq(trackingParameters.key, "store_code"));
    await importOptions({ error: "", ok: "" }, form({ parameter_id: param.id, options: "KL001" }));

    const empty = { error: "", checked: false, ready: 0, skipped: 0, problems: [], problemCount: 0, sample: [], jobId: "" };
    const result = await bulkPlacements(empty, form({ slug: "promo", csv: "name,store_code\nDoor,KL001\nTill,", intent: "create" }));
    expect(result.error).toBe("");
    // The action has answered; the work runs in after().
    await Promise.all(pending.splice(0));

    const [job] = await db().select().from(bulkJobs);
    expect(job).toMatchObject({ id: result.jobId, status: "done", processed: 2 });
    expect(Object.keys(unzipSync(new Uint8Array(job.zip!)))).toHaveLength(3);
    expect((await listPlacements(linkId)).map((p) => p.name)).toEqual(["Door", "Till"]);
  });
});
