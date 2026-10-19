import { eq } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/accounts";
import { rebuildTotals, rollUpClicks } from "@/lib/click-rollup";
import { clicks, links, placements, workspaces } from "@/lib/db/schema";
import { readLayout } from "@/lib/overview-layout";
import { createUser, createWorkspace, db, form, resetData } from "./helpers";
import { testDatabaseUrl } from "./test-db";

// after() needs a Next.js request scope; collect the tasks so tests can wait for them.
const pending = vi.hoisted(() => [] as Promise<unknown>[]);
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: (task: () => unknown) => void pending.push(Promise.resolve().then(task)) };
});
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireOrgAdmin: async () => {
      if (!session.user?.isOrgAdmin) throw new Error("not an org admin");
      return session.user;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
// The rebuild job runs through the queue; run it here against the test database.
const client = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
vi.mock("@/lib/queue", () => ({
  jobsRunInline: () => true,
  enqueue: async (name: string, data: { workspaceId: string } | { linkIds: string[] }) => {
    if (name === "rebuild-totals") await rebuildTotals(client, data);
    if (name === "click-rollup") await rollUpClicks(client);
  },
}));
afterAll(() => client.end());

const { listLinks, loadDashboard, loadDetail } = await import("@/lib/data");
const { updateWorkspaceTimezone } = await import("@/lib/admin-actions");
const { loadOverview } = await import("@/lib/overview-data");

let workspaceId: string;
let linkId: string;
const DAY = 86_400_000;

// A click at an exact moment, so tests can sit on either side of a local midnight.
async function click(at: Date, extra: Partial<typeof clicks.$inferInsert> = {}) {
  await db().insert(clicks).values({ linkId, visitorId: `v-${Math.random()}`, clickedAt: at.toISOString(), ...extra });
}

// 17:30 UTC on a day `daysAgo` before today (UTC): 01:30 the next morning in Malaysia (UTC+8).
function eveningUtc(daysAgo: number): Date {
  const d = new Date(Date.now() - daysAgo * DAY);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 17, 30));
}
const utcDay = (at: Date) => at.toISOString().slice(0, 10);
const nextDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY).toISOString().slice(0, 10);

beforeEach(async () => {
  pending.splice(0);
  await resetData();
  workspaceId = await createWorkspace();
  session.user = await createUser({ [workspaceId]: "owner" }, { isOrgAdmin: true });
  [{ id: linkId }] = await db()
    .insert(links)
    .values({ slug: "promo", url: "https://example.com", tags: ["email"], workspaceId, createdBy: session.user.id })
    .returning({ id: links.id });
});

describe("overview from daily totals", () => {
  it("gives the same numbers before and after the rollup, and keeps them when old clicks are gone", async () => {
    const tenDays = eveningUtc(10);
    await click(tenDays, { tag: "email", country: "MY", referrer: "https://mail.example", ip: "1.1.1.1", visitorId: "a" });
    await click(tenDays, { country: "MY", ip: "1.1.1.1", visitorId: "a" });
    await click(eveningUtc(40), { country: "SG", ip: "2.2.2.2" });
    await click(new Date(), { tag: "email", ip: "3.3.3.3" });
    await click(new Date(), { isBot: true });

    const pick = (d: Awaited<ReturnType<typeof loadDetail>>) => {
      if (!d.ok || !d.data) throw new Error("no detail");
      const { recent: _, ...rest } = d.data;
      return rest;
    };
    const before = pick(await loadDetail("promo"));
    expect(before).toMatchObject({
      total_clicks: 4,
      unique_ips: 3,
      bot_clicks: 1,
      clicks_today: 1,
      untagged_clicks: 2,
      tag_stats: [{ tag: "email", clicks: 2, visitors: 2 }],
      timezone: "Asia/Kuala_Lumpur",
    });
    expect(before.countries).toEqual([
      { country: "MY", clicks: 2 },
      // Ties by code; no location ("") sorts first.
      { country: "Unknown", clicks: 1 },
      { country: "SG", clicks: 1 },
    ]);
    expect(before.referrers[0]).toEqual({ referrer: "Direct", clicks: 3 });

    await rollUpClicks(client);
    expect(pick(await loadDetail("promo"))).toEqual(before);
    await client`delete from clicks where clicked_at < now() - interval '2 days'`;
    expect(pick(await loadDetail("promo"))).toEqual(before);
  });

  it("counts a 17:30 UTC click on the next day in Malaysia, and moves it back after switching to UTC", async () => {
    const at = eveningUtc(5);
    await click(at);
    await rollUpClicks(client);
    const dayOf = async () => {
      const detail = await loadDetail("promo");
      return detail.ok ? detail.data?.daily.find((d) => d.clicks > 0)?.day : null;
    };
    expect(await dayOf()).toBe(nextDay(utcDay(at)));

    const result = await updateWorkspaceTimezone({ error: "", ok: "" }, form({ workspace_id: workspaceId, timezone: "UTC" }));
    expect(result.error).toBe("");
    // The rebuild waits for a UTC rollup to exist; run one, then the queued rebuild.
    await rollUpClicks(client);
    await Promise.all(pending.splice(0));
    expect(await dayOf()).toBe(utcDay(at));
    const [row] = await db().select().from(workspaces).where(eq(workspaces.id, workspaceId));
    expect(row.timezone).toBe("UTC");
  });

  it("rejects timezones that do not exist, and is only for org admins", async () => {
    expect((await updateWorkspaceTimezone({ error: "", ok: "" }, form({ workspace_id: workspaceId, timezone: "Mars/Olympus" }))).error).toBe(
      "Choose a timezone from the list.",
    );
    session.user = await createUser({ [workspaceId]: "owner" });
    await expect(
      updateWorkspaceTimezone({ error: "", ok: "" }, form({ workspace_id: workspaceId, timezone: "UTC" })),
    ).rejects.toThrow();
  });
});

describe("dashboard and link list from daily totals", () => {
  it("adds up links, today and the last 7 days, and names the timezones", async () => {
    await click(eveningUtc(3), { tag: "email", country: "MY" });
    await click(eveningUtc(20));
    await click(new Date(), { isBot: true });
    await rollUpClicks(client);
    await click(new Date(), { country: "MY" });

    const dashboard = await loadDashboard({ workspaceIds: [workspaceId] });
    expect(dashboard.ok && dashboard.data).toMatchObject({
      clicks: 3,
      clicksToday: 1,
      clicks7d: 2,
      botClicks: 1,
      tags: [{ tag: "", clicks: 2 }, { tag: "email", clicks: 1 }],
      countries: [{ country: "MY", clicks: 2 }, { country: "Unknown", clicks: 1 }],
      timezones: ["Asia/Kuala_Lumpur"],
    });
    expect(dashboard.ok && dashboard.data.daily).toHaveLength(30);

    const list = await listLinks({ workspaceIds: [workspaceId] });
    expect(list.ok && list.data.map((l) => [l.slug, l.click_count])).toEqual([["promo", 3]]);
  });
});

describe("overview for a period", () => {
  it("totals the period, compares with the one before, and picks the trend's steps", async () => {
    const [{ id: placementId }] = await db()
      .insert(placements)
      .values({ linkId, code: "poster01", labelKey: "name=|x" })
      .returning({ id: placements.id });
    await db().insert(placements).values({ linkId, code: "unused01", labelKey: "name=|y" });
    await click(new Date(), { placementId });
    await click(new Date());
    await click(new Date(), { isBot: true });
    await click(eveningUtc(3), { country: "MY" });
    // The 7 days before the last 7.
    await click(eveningUtc(9));
    await click(eveningUtc(400));
    await rollUpClicks(client);

    const today = await loadOverview(linkId, "today");
    expect(today.totals).toMatchObject({ clicks: 2, botClicks: 1 });
    expect(today.granularity).toBe("hour");
    expect(today.trend.reduce((n, t) => n + t.clicks, 0)).toBe(2);
    expect(today).toMatchObject({ labelledUsed: 1, labelledActive: 2 });

    const week = await loadOverview(linkId, "7d");
    expect(week.totals.clicks).toBe(3);
    expect(week.previous?.clicks).toBe(1);
    expect(week.trend).toHaveLength(7);
    expect(week.countries[0]).toEqual({ country: "Unknown", clicks: 2 });

    const all = await loadOverview(linkId, "all");
    expect(all).toMatchObject({ granularity: "month", previous: null });
    expect(all.totals.clicks).toBe(5);
    expect(all.trend.reduce((n, t) => n + t.clicks, 0)).toBe(5);
    expect(all.trend.length).toBeGreaterThanOrEqual(13);
  });

  it("reads a saved layout, ignoring anything it does not understand", () => {
    expect(readLayout(JSON.stringify({ period: "30d", hidden: ["map", 3, "label:store"] }))).toEqual({
      period: "30d",
      hidden: ["map", "label:store"],
    });
    expect(readLayout("not json")).toEqual({ period: "7d", hidden: [] });
    expect(readLayout(JSON.stringify({ period: "year" }))).toEqual({ period: "7d", hidden: [] });
  });
});
