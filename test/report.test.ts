import { eq, sql as sqlTag } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/accounts";
import { clicks, links, trackingParameters } from "@/lib/db/schema";
import { createUser, createWorkspace, db, form, resetData } from "./helpers";

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

const { createParameter, importOptions } = await import("@/lib/parameter-actions");
const { insertPlacement } = await import("@/lib/placement-data");
const { linkReport, readReportQuery, reportParameters } = await import("@/lib/report-data");
const { GET: reportCsv } = await import("@/app/stats/[slug]/report/route");

let workspaceId: string;
let linkId: string;
// parameter id, and option id by value, per key
const params: Record<string, { id: string; options: Record<string, string> }> = {};

async function addDropdown(key: string, name: string, values: string) {
  await createParameter({ error: "", ok: "" }, form({ workspace_id: workspaceId, name, key, field_type: "dropdown" }));
  const [row] = await db().select().from(trackingParameters).where(eqKey(key));
  await importOptions({ error: "", ok: "" }, form({ parameter_id: row.id, options: values }));
  const options = await db().execute<{ id: string; value: string }>(
    sqlTag`select id, value from tracking_parameter_options where parameter_id = ${row.id}`,
  );
  params[key] = { id: row.id, options: Object.fromEntries([...options].map((o) => [o.value, o.id])) };
}

async function labelled(values: Record<string, string>) {
  const placement = await insertPlacement({
    linkId,
    name: null,
    createdBy: null,
    values: Object.entries(values).map(([key, value]) => ({
      parameterId: params[key].id,
      key,
      value,
      optionId: params[key].options[value] ?? null,
    })),
  });
  return placement.id;
}

async function visits(placementId: string | null, count: number, extra: { isBot?: boolean; daysAgo?: number; visitor?: string } = {}) {
  const clickedAt = new Date(Date.now() - (extra.daysAgo ?? 0) * 86_400_000).toISOString();
  await db()
    .insert(clicks)
    .values(
      Array.from({ length: count }, (_, i) => ({
        linkId,
        placementId,
        visitorId: extra.visitor ?? `v-${placementId}-${i}-${extra.daysAgo ?? 0}`,
        isBot: extra.isBot ?? false,
        clickedAt,
      })),
    );
}

const eqKey = (key: string) => eq(trackingParameters.key, key);

const simple = (report: Awaited<ReturnType<typeof linkReport>>) =>
  report.rows.map((row) => [row.direct ? "main" : row.cells.map((c) => c?.value ?? "-").join("/"), row.clicks]);

beforeEach(async () => {
  await resetData();
  workspaceId = await createWorkspace();
  session.user = await createUser({ [workspaceId]: "owner" });
  [{ id: linkId }] = await db()
    .insert(links)
    .values({ slug: "promo", url: "https://example.com", workspaceId, createdBy: session.user.id })
    .returning({ id: links.id });
  await addDropdown("store", "Store", "KL001,Mid Valley\nPG002");
  await addDropdown("channel", "Channel", "email\nwhatsapp");
  await addDropdown("campaign", "Campaign", "RAYA");

  const klEmail = await labelled({ store: "KL001", channel: "email" });
  const klWhatsapp = await labelled({ store: "KL001", channel: "whatsapp" });
  const pgEmail = await labelled({ store: "PG002", channel: "email" });
  await visits(klEmail, 5);
  await visits(klWhatsapp, 3);
  await visits(pgEmail, 2);
  await visits(pgEmail, 4, { isBot: true });
  await visits(null, 1);
  await visits(klEmail, 6, { daysAgo: 45 });
});

describe("link report", () => {
  it("offers only the labels the link's labelled links use, in workspace order", async () => {
    expect((await reportParameters(linkId)).map((p) => p.key)).toEqual(["store", "channel"]);
  });

  it("groups human visits by one label, with the main link apart and bots left out", async () => {
    const report = await linkReport(linkId, [params.store.id], "30d");
    expect(simple(report)).toEqual([
      ["KL001", 8],
      ["PG002", 2],
      ["main", 1],
    ]);
    expect(report.rows[0].cells[0]).toEqual({ value: "KL001", label: "Mid Valley" });
    expect(report).toMatchObject({ totalClicks: 11, truncated: false });
  });

  it("crosses two labels, and widens with the period", async () => {
    expect(simple(await linkReport(linkId, [params.store.id, params.channel.id], "30d"))).toEqual([
      ["KL001/email", 5],
      ["KL001/whatsapp", 3],
      ["PG002/email", 2],
      ["main", 1],
    ]);
    expect(simple(await linkReport(linkId, [params.store.id, params.channel.id], "all"))[0]).toEqual(["KL001/email", 11]);
  });

  it("shows Not set for a label the visit's labelled link does not have", async () => {
    expect(simple(await linkReport(linkId, [params.campaign.id], "30d"))).toEqual([
      ["-", 10],
      ["main", 1],
    ]);
  });

  it("reads by= and range= from the address, dropping unknown keys", async () => {
    const available = await reportParameters(linkId);
    expect(readReportQuery({ by: "channel,nope,STORE", range: "7d" }, available, [])).toMatchObject({
      groupBy: [{ key: "channel" }, { key: "store" }],
      range: "7d",
    });
    expect(readReportQuery({}, available, available.slice(0, 1))).toMatchObject({ groupBy: [{ key: "store" }], range: "30d" });
  });

  it("exports the same numbers as CSV, only to people who can see the link", async () => {
    const response = await reportCsv(new NextRequest("http://localhost/stats/promo/report?by=channel&range=30d"), {
      params: Promise.resolve({ slug: "promo" }),
    });
    expect(response.headers.get("content-type")).toMatch(/text\/csv/);
    expect((await response.text()).trim().split(/\r?\n/)).toEqual([
      "channel,channel_label,came_through,clicks,visitors",
      "email,,labelled link,7,7",
      "whatsapp,,labelled link,3,3",
      ",,main link,1,1",
    ]);

    session.user = await createUser({ [await createWorkspace()]: "owner" });
    const hidden = await reportCsv(new NextRequest("http://localhost/stats/promo/report"), { params: Promise.resolve({ slug: "promo" }) });
    expect(hidden.status).toBe(404);
  });
});
