import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clicks, links, placements } from "@/lib/db/schema";
import { JOB_NAMES, type ClickJob } from "@/lib/jobs/catalog";
import { insertClicks } from "@/lib/jobs/click-job";
import { jobHandlers } from "@/lib/jobs/handlers";
import { uuidv7 } from "@/lib/uuid7";
import { createWorkspace, db, resetData } from "./helpers";
import { testDatabaseUrl } from "./test-db";

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
const queue = vi.hoisted(() => ({ sent: [] as { name: string; data: unknown }[], fail: false }));
vi.mock("@/lib/queue", () => ({
  enqueue: async (name: string, data: unknown) => {
    if (queue.fail) throw new Error("queue down");
    queue.sent.push({ name, data });
  },
}));

const { GET: tagRoute } = await import("@/app/r/[slug]/[tag]/route");

const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
afterAll(() => sql.end());

let linkId: string;

beforeEach(async () => {
  await resetData();
  queue.sent.length = 0;
  queue.fail = false;
  const workspaceId = await createWorkspace();
  [{ id: linkId }] = await db()
    .insert(links)
    .values({ slug: "promo", url: "https://example.com", tags: ["email"], workspaceId })
    .returning({ id: links.id });
});

afterEach(() => {
  delete process.env.CLICK_INGEST;
});

function click(overrides: Partial<ClickJob> = {}): ClickJob {
  return {
    id: uuidv7(),
    linkId,
    visitorId: "v1",
    ip: "203.0.113.5",
    userAgent: "Mozilla/5.0",
    referrer: null,
    country: "MY",
    region: null,
    city: null,
    isBot: false,
    tag: null,
    placementId: null,
    clickedAt: "2026-10-01T08:00:00.000Z",
    ...overrides,
  };
}

describe("job catalog", () => {
  it("has a handler for every job", () => {
    const handlers = jobHandlers(sql);
    for (const name of JOB_NAMES) expect(typeof handlers[name]).toBe("function");
  });

  it("makes time-ordered v7 ids", () => {
    const a = uuidv7(1_700_000_000_000);
    const b = uuidv7(1_700_000_000_001);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(a < b).toBe(true);
    expect(a.slice(0, 13).replace("-", "")).toBe((1_700_000_000_000).toString(16).padStart(12, "0"));
  });
});

describe("queued clicks", () => {
  it("saves a batch with the visit's own time, and only once when retried", async () => {
    const batch = [click(), click({ visitorId: "v2", isBot: true })];
    expect(await insertClicks(sql, batch)).toBe(2);
    expect(await insertClicks(sql, batch)).toBe(0);
    const rows = await db().select().from(clicks);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.clickedAt).every((t) => t.startsWith("2026-10-01"))).toBe(true);
    expect(rows.find((r) => r.visitorId === "v2")?.isBot).toBe(true);
  });

  it("counts a tag visit for the placement made from that tag, as direct saving does", async () => {
    const [placement] = await db()
      .insert(placements)
      .values({ linkId, code: "abcdefgh", legacyTag: "email" })
      .returning({ id: placements.id });
    await insertClicks(sql, [click({ tag: "email" }), click({ tag: null })]);
    const rows = await db().select().from(clicks);
    expect(rows.find((r) => r.tag === "email")?.placementId).toBe(placement.id);
    expect(rows.find((r) => r.tag === null)?.placementId).toBeNull();
  });

  it("drops clicks for a link deleted while they waited", async () => {
    const orphan = click();
    await db().delete(links).where(eq(links.id, linkId));
    expect(await insertClicks(sql, [orphan])).toBe(0);
  });

  it("goes through the queue when CLICK_INGEST=queue, keeping the visit time", async () => {
    process.env.CLICK_INGEST = "queue";
    const response = await tagRoute(
      new NextRequest("http://localhost/r/promo/email", { headers: { "sec-fetch-mode": "navigate", "user-agent": "Mozilla/5.0" } }),
      { params: Promise.resolve({ slug: "promo", tag: "email" }) },
    );
    await Promise.all(pending.splice(0));
    expect(response.status).toBe(302);
    expect(await db().select().from(clicks)).toEqual([]);
    expect(queue.sent).toEqual([
      { name: "record-click", data: expect.objectContaining({ linkId, tag: "email", placementId: null, isBot: false }) },
    ]);
    const job = queue.sent[0].data as ClickJob;
    expect(Math.abs(Date.parse(job.clickedAt) - Date.now())).toBeLessThan(5000);

    // The worker's handler then saves it.
    await jobHandlers(sql)["record-click"]([{ id: "j1", data: job, attempt: 1 }]);
    expect(await db().select().from(clicks)).toHaveLength(1);
  });

  it("saves directly when the queue cannot take the click", async () => {
    process.env.CLICK_INGEST = "queue";
    queue.fail = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    await tagRoute(
      new NextRequest("http://localhost/r/promo/email", { headers: { "sec-fetch-mode": "navigate", "user-agent": "Mozilla/5.0" } }),
      { params: Promise.resolve({ slug: "promo", tag: "email" }) },
    );
    await Promise.all(pending.splice(0));
    expect(await db().select().from(clicks)).toHaveLength(1);
  });
});
