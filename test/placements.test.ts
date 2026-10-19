import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import postgres from "postgres";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/accounts";
import { clicks, links, placements, placementValues, trackingParameters } from "@/lib/db/schema";
import { tagsToParameters, undoTagsToParameters } from "@/lib/tag-migration";
import { createUser, createWorkspace, db, form, resetData } from "./helpers";
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
const session = vi.hoisted(() => ({ user: null as SessionUser | null }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    requireUser: async () => {
      if (!session.user) throw new Error("not signed in");
      return session.user;
    },
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("@/lib/origin", () => ({ appOrigin: async () => "https://lt.example" }));

const { GET: placementRoute } = await import("@/app/q/[code]/route");
const { GET: tagRoute } = await import("@/app/r/[slug]/[tag]/route");
const { createPlacement, setPlacementStatus } = await import("@/lib/placement-actions");
const { listPlacements } = await import("@/lib/placement-data");
const { createParameter, importOptions } = await import("@/lib/parameter-actions");
const { createLink, moveLinkToWorkspace } = await import("@/lib/actions");

const sql = postgres(testDatabaseUrl(), { max: 1, onnotice: () => {} });
afterAll(() => sql.end());

const BROWSER = { "user-agent": "Mozilla/5.0 Chrome/130.0", "sec-fetch-mode": "navigate" };
const empty = { error: "", fieldErrors: {}, code: "" };

async function scan(path: string, method = "GET") {
  const request = new NextRequest(`http://localhost${path}`, { method, headers: BROWSER });
  const [, kind, a, b] = path.split("/");
  const response =
    kind === "q"
      ? await placementRoute(request, { params: Promise.resolve({ code: a }) })
      : await tagRoute(request, { params: Promise.resolve({ slug: a, tag: b }) });
  await Promise.all(pending.splice(0));
  return response;
}

let workspaceId: string;
let otherWorkspaceId: string;
let linkId: string;

async function addStoreParameter(required = true) {
  await createParameter(
    { error: "", ok: "" },
    form({ workspace_id: workspaceId, name: "Store", key: "store_code", field_type: "dropdown", ...(required ? { is_required: "on" } : {}) }),
  );
  const [param] = await db().select().from(trackingParameters).where(eq(trackingParameters.key, "store_code"));
  await importOptions({ error: "", ok: "" }, form({ parameter_id: param.id, options: "KL001,Mid Valley\nPG002" }));
  await createParameter({ error: "", ok: "" }, form({ workspace_id: workspaceId, name: "Booth", key: "booth", field_type: "text" }));
  return param.id;
}

beforeEach(async () => {
  await resetData();
  workspaceId = await createWorkspace();
  otherWorkspaceId = await createWorkspace();
  session.user = await createUser({ [workspaceId]: "owner", [otherWorkspaceId]: "owner" });
  [{ id: linkId }] = await db()
    .insert(links)
    .values({ slug: "promo", url: "https://example.com/promo", tags: ["email", "lark"], workspaceId, createdBy: session.user.id })
    .returning({ id: links.id });
});

describe("creating placements", () => {
  it("stores the values, with dropdown codes as defined", async () => {
    await addStoreParameter();
    const result = await createPlacement(empty, form({ slug: "promo", name: "Entrance", "param:store_code": "kl001", "param:booth": "B12" }));
    expect(result.error).toBe("");
    expect(result.code).toMatch(/^[a-z0-9]{8}$/);
    const [row] = await listPlacements(linkId);
    expect(row).toMatchObject({ code: result.code, name: "Entrance", legacyTag: null, isActive: true, clicks: 0 });
    expect(row.values.map((v) => [v.key, v.value, v.label])).toEqual([
      ["store_code", "KL001", "Mid Valley"],
      ["booth", "B12", null],
    ]);
  });

  it("works when the workspace has no parameters", async () => {
    const result = await createPlacement(empty, form({ slug: "promo" }));
    expect(result.error).toBe("");
    expect((await listPlacements(linkId))[0].values).toEqual([]);
  });

  it("rejects unknown options and keys", async () => {
    await addStoreParameter();
    expect((await createPlacement(empty, form({ slug: "promo", "param:store_code": "ZZ9" }))).fieldErrors.store_code).toMatch(
      /not an option/,
    );
    expect((await createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001", "param:other": "x" }))).fieldErrors).toEqual({
      other: "This label is not available.",
    });
    expect(await listPlacements(linkId)).toEqual([]);
  });

  it("uses only the link's own workspace parameters", async () => {
    await addStoreParameter();
    const [other] = await db()
      .insert(links)
      .values({ slug: "other", url: "https://example.com", workspaceId: otherWorkspaceId })
      .returning({ id: links.id });
    // store_code belongs to the first workspace, so it is not available here.
    const result = await createPlacement(empty, form({ slug: "other", "param:store_code": "KL001" }));
    expect(result.fieldErrors).toEqual({ store_code: "This label is not available." });
    expect(await listPlacements(other.id)).toEqual([]);
  });

  it("needs the editor role, and hides links in other workspaces", async () => {
    session.user = await createUser({ [workspaceId]: "viewer" });
    expect((await createPlacement(empty, form({ slug: "promo" }))).error).toBe("You cannot add labelled links in this workspace.");
    session.user = await createUser({ [otherWorkspaceId]: "owner" });
    expect((await createPlacement(empty, form({ slug: "promo" }))).error).toBe("That link could not be found.");
  });

  it("gives every placement a unique code when created at the same time", async () => {
    // Different names, so none is a duplicate of another.
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => createPlacement(empty, form({ slug: "promo", name: `Spot ${i}` }))),
    );
    expect(results.every((r) => r.error === "")).toBe(true);
    expect(new Set(results.map((r) => r.code)).size).toBe(12);
  });

  it("stops a link with placements from moving to another workspace", async () => {
    await createPlacement(empty, form({ slug: "promo" }));
    const result = await moveLinkToWorkspace({ error: "", ok: "" }, form({ slug: "promo", workspace_id: otherWorkspaceId }));
    expect(result.error).toMatch(/cannot be moved/);
  });
});

describe("first placement on the create-link form", () => {
  const base = () => ({ workspace_id: workspaceId, url: "https://example.com/new" });

  it("creates the link and its placement together", async () => {
    await addStoreParameter();
    const result = await createLink(
      { error: "", slug: "" },
      form({ ...base(), slug: "with-qr", placement_name: "Poster", "param:store_code": "PG002" }),
    );
    expect(result).toMatchObject({ error: "", slug: "with-qr", placementCode: expect.stringMatching(/^[a-z0-9]{8}$/) });
    const [link] = await db().select().from(links).where(eq(links.slug, "with-qr"));
    const [placement] = await listPlacements(link.id);
    expect(placement).toMatchObject({ code: result.placementCode, name: "Poster" });
    expect(placement.values.map((v) => `${v.key}=${v.value}`)).toEqual(["store_code=PG002"]);
  });

  it("creates nothing when a placement value is rejected", async () => {
    await addStoreParameter();
    const wrong = await createLink(
      { error: "", slug: "" },
      form({ ...base(), slug: "nope", "param:store_code": "ZZ9" }),
    );
    expect(wrong.fieldErrors?.store_code).toMatch(/not an option/);
    expect(await db().select().from(links).where(eq(links.slug, "nope"))).toEqual([]);
  });

  it("skips the placement when nothing is filled in, and works with no parameters", async () => {
    await addStoreParameter();
    const plain = await createLink(
      { error: "", slug: "" },
      form({ ...base(), slug: "plain-new", placement_name: " ", "param:store_code": "" }),
    );
    expect(plain).toEqual({ error: "", slug: "plain-new" });
    session.user = await createUser({ [otherWorkspaceId]: "editor" });
    const bare = await createLink(
      { error: "", slug: "" },
      form({ workspace_id: otherWorkspaceId, url: "https://example.com", slug: "bare", placement_name: "Counter" }),
    );
    expect(bare.placementCode).toMatch(/^[a-z0-9]{8}$/);
  });
});

describe("several values for one label", () => {
  // form() keeps one value per name; these repeat a field the way the picker does.
  function withRepeats(values: Record<string, string>, repeats: [string, string][]) {
    const data = form(values);
    for (const [name, value] of repeats) data.append(name, value);
    return data;
  }

  async function storesOf(slug: string) {
    const [link] = await db().select().from(links).where(eq(links.slug, slug));
    const rows = await listPlacements(link.id);
    return rows.map((p) => [p.name, ...p.values.map((v) => `${v.key}=${v.value}`)]).sort();
  }

  it("makes one QR code per store from the create-link form, sharing the other labels", async () => {
    await addStoreParameter();
    const result = await createLink(
      { error: "", slug: "" },
      withRepeats(
        { workspace_id: workspaceId, url: "https://example.com/new", slug: "many", placement_name: "Poster", "param:booth": "B1" },
        [
          ["param:store_code", "KL001"],
          ["param:store_code", "pg002"],
          ["param:store_code", "kl001"],
        ],
      ),
    );
    expect(result).toEqual({ error: "", slug: "many", queuedCount: 2 });
    await Promise.all(pending.splice(0));
    expect(await storesOf("many")).toEqual([
      ["Poster", "store_code=KL001", "booth=B1"],
      ["Poster", "store_code=PG002", "booth=B1"],
    ]);
  });

  it("makes every combination when several labels have several values", async () => {
    await addStoreParameter();
    const result = await createLink(
      { error: "", slug: "" },
      withRepeats({ workspace_id: workspaceId, url: "https://example.com/new", slug: "combo", qr_format: "svg" }, [
        ["param:store_code", "KL001"],
        ["param:store_code", "PG002"],
        ["param:booth", "B1"],
        ["param:booth", "B2"],
      ]),
    );
    expect(result).toEqual({ error: "", slug: "combo", queuedCount: 4 });
    await Promise.all(pending.splice(0));
    expect(await storesOf("combo")).toEqual([
      [null, "store_code=KL001", "booth=B1"],
      [null, "store_code=KL001", "booth=B2"],
      [null, "store_code=PG002", "booth=B1"],
      [null, "store_code=PG002", "booth=B2"],
    ]);
    const [job] = await sql<{ format: string }[]>`select b.format from bulk_jobs b join links l on l.id = b.link_id where l.slug = 'combo'`;
    expect(job.format).toBe("svg");
  });

  it("rejects the whole batch when one store is not an option", async () => {
    await addStoreParameter();
    const result = await createPlacement(
      empty,
      withRepeats({ slug: "promo" }, [
        ["param:store_code", "KL001"],
        ["param:store_code", "ZZ9"],
      ]),
    );
    expect(result.fieldErrors.store_code).toMatch(/"ZZ9" is not an option/);
    expect(await listPlacements(linkId)).toEqual([]);
  });

  it("queues a zip from the link page's form too", async () => {
    await addStoreParameter();
    const result = await createPlacement(
      empty,
      withRepeats({ slug: "promo", name: "Counter" }, [
        ["param:store_code", "KL001"],
        ["param:store_code", "PG002"],
      ]),
    );
    expect(result).toMatchObject({ error: "", code: "", queuedCount: 2, queuedJobId: expect.any(String) });
    await Promise.all(pending.splice(0));
    expect(await storesOf("promo")).toEqual([
      ["Counter", "store_code=KL001"],
      ["Counter", "store_code=PG002"],
    ]);
    const [job] = await sql<{ status: string; total: number }[]>`select status, total from bulk_jobs where id = ${result.queuedJobId!}`;
    expect(job).toEqual({ status: "done", total: 2 });
  });
});

describe("one active labelled link per set of labels", () => {
  it("refuses a duplicate, ignoring case, and names the existing one", async () => {
    await addStoreParameter();
    const first = await createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001", "param:booth": "B1" }));
    expect(first.error).toBe("");
    const again = await createPlacement(empty, form({ slug: "promo", "param:store_code": "kl001", "param:booth": "b1" }));
    expect(again.error).toBe(`A labelled link with these labels already exists: /q/${first.code}. Deactivate it first to replace it.`);
    // A different set of labels is fine, even if it only drops one.
    expect((await createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001" }))).error).toBe("");
    expect(await listPlacements(linkId)).toHaveLength(2);
  });

  it("lets only one of two identical creates at the same moment through", async () => {
    await addStoreParameter();
    const results = await Promise.all(
      Array.from({ length: 4 }, () => createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001" }))),
    );
    expect(results.filter((r) => r.error === "")).toHaveLength(1);
    expect(results.filter((r) => r.error.startsWith("A labelled link with these labels already exists"))).toHaveLength(3);
    expect(await listPlacements(linkId)).toHaveLength(1);
  });

  it("does not activate one while another active one has the same labels", async () => {
    await addStoreParameter();
    await createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001" }));
    const [old] = await listPlacements(linkId);
    await setPlacementStatus({ error: "", ok: "" }, form({ placement_id: old.id, is_active: "false" }));
    const replacement = await createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001" }));
    const back = await setPlacementStatus({ error: "", ok: "" }, form({ placement_id: old.id, is_active: "true" }));
    expect(back.error).toBe(
      `It cannot be activated: /q/${replacement.code} has the same labels. Deactivate that one first.`,
    );
  });

  it("lets a deactivated one be replaced", async () => {
    await addStoreParameter();
    const first = await createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001" }));
    const [row] = await listPlacements(linkId);
    await setPlacementStatus({ error: "", ok: "" }, form({ placement_id: row.id, is_active: "false" }));
    const second = await createPlacement(empty, form({ slug: "promo", "param:store_code": "KL001" }));
    expect(second.error).toBe("");
    expect(second.code).not.toBe(first.code);
  });

  it("skips existing ones in a batch, and refuses a batch that is all duplicates", async () => {
    await addStoreParameter();
    await createPlacement(empty, form({ slug: "promo", "param:store_code": "PG002" }));
    const both = () => {
      const data = form({ slug: "promo" });
      data.append("param:store_code", "KL001");
      data.append("param:store_code", "PG002");
      return data;
    };
    const result = await createPlacement(empty, both());
    expect(result).toMatchObject({ error: "", code: expect.stringMatching(/^[a-z0-9]{8}$/), skippedCount: 1 });
    expect((await createPlacement(empty, both())).error).toBe("All 2 already exist, so there is nothing to add.");
  });
});

describe("/q/<code>", () => {
  it("redirects to the link and records the placement", async () => {
    const { code } = await createPlacement(empty, form({ slug: "promo" }));
    const response = await scan(`/q/${code}`);
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/promo");
    const rows = await db().select().from(clicks);
    expect(rows).toEqual([expect.objectContaining({ linkId, tag: null, isBot: false })]);
    expect((await listPlacements(linkId))[0].clicks).toBe(1);
  });

  it("matches the code regardless of case, and still redirects when inactive", async () => {
    const { code } = await createPlacement(empty, form({ slug: "promo" }));
    const [{ id }] = await listPlacements(linkId);
    await setPlacementStatus({ error: "", ok: "" }, form({ placement_id: id, is_active: "false" }));
    expect((await scan(`/q/${code.toUpperCase()}`)).status).toBe(302);
  });

  it("returns 404 for unknown codes and does not record HEAD requests", async () => {
    expect((await scan("/q/nosuchcode")).status).toBe(404);
    expect((await scan("/q/bad")).status).toBe(404);
    const { code } = await createPlacement(empty, form({ slug: "promo" }));
    await scan(`/q/${code}`, "HEAD");
    expect(await db().select().from(clicks)).toEqual([]);
  });
});

describe("tags to parameters script", () => {
  async function snapshot() {
    const linkRows = await sql`select id, slug, tags, url from links order by id`;
    const clickRows = await sql`select id, link_id, visitor_id, tag, is_bot, clicked_at from clicks order by id`;
    return { linkRows, clickRows };
  }

  beforeEach(async () => {
    await db().insert(links).values({ slug: "notags", url: "https://example.com", workspaceId });
    await db().insert(clicks).values([
      { linkId, visitorId: "v1", tag: "email" },
      { linkId, visitorId: "v2", tag: "email" },
      { linkId, visitorId: "v3", tag: "lark" },
      { linkId, visitorId: "v4", tag: null },
    ]);
  });

  it("previews without changing anything", async () => {
    const before = await snapshot();
    const [report] = await tagsToParameters(sql, { key: "platform", name: "Platform", apply: false });
    expect(report).toMatchObject({ parameter: "created", optionsAdded: ["email", "lark"], placementsCreated: 2, clicksLinked: 3 });
    expect(await snapshot()).toEqual(before);
    expect(await db().select().from(placements)).toEqual([]);
    expect(await db().select().from(trackingParameters)).toEqual([]);
  });

  it("makes a parameter, options and placements, and links past and future tag visits", async () => {
    const before = await snapshot();
    const [report] = await tagsToParameters(sql, { key: "platform", name: "Platform", apply: true });
    expect(report).toMatchObject({ parameter: "created", placementsCreated: 2, clicksLinked: 3 });
    // Tags and clicks keep their values; only placement_id is filled in.
    expect(await snapshot()).toEqual(before);

    const rows = await listPlacements(linkId);
    expect(rows.map((p) => [p.name, p.legacyTag, p.clicks, p.values.map((v) => `${v.key}=${v.value}`)])).toEqual([
      ["email", "email", 2, ["platform=email"]],
      ["lark", "lark", 1, ["platform=lark"]],
    ]);

    // New visits to the old tag address count for the placement too, and the address still works.
    expect((await scan("/r/promo/lark")).status).toBe(302);
    expect((await listPlacements(linkId)).find((p) => p.legacyTag === "lark")?.clicks).toBe(2);
    // The placement's own code counts under the tag as well.
    await scan(`/q/${rows[0].code}`);
    const [{ count }] = await sql`select count(*)::int as count from clicks where tag = 'email'`;
    expect(count).toBe(3);
  });

  it("can be run again without making duplicates, and picks up new tags", async () => {
    await tagsToParameters(sql, { key: "platform", name: "Platform", apply: true });
    await db().update(links).set({ tags: ["email", "lark", "whatsapp"] }).where(eq(links.id, linkId));
    const [again] = await tagsToParameters(sql, { key: "platform", name: "Platform", apply: true });
    expect(again).toMatchObject({ parameter: "existing", optionsAdded: ["whatsapp"], placementsCreated: 1, clicksLinked: 0 });
    expect(await db().select().from(placements)).toHaveLength(3);
  });

  it("skips a workspace whose key is already a text parameter", async () => {
    await createParameter({ error: "", ok: "" }, form({ workspace_id: workspaceId, name: "Platform", key: "platform", field_type: "text" }));
    const [report] = await tagsToParameters(sql, { key: "platform", name: "Platform", apply: true });
    expect(report).toMatchObject({ parameter: "skipped", placementsCreated: 0 });
  });

  it("undo removes only what it made", async () => {
    const before = await snapshot();
    await tagsToParameters(sql, { key: "platform", name: "Platform", apply: true });
    const { code } = await createPlacement(empty, form({ slug: "promo", name: "Made in the app" }));

    const [report] = await undoTagsToParameters(sql, { apply: true });
    expect(report).toMatchObject({ placementsRemoved: 2, clicksUnlinked: 3, parameterRemoved: true });
    expect(await snapshot()).toEqual(before);
    expect((await db().select().from(placements)).map((p) => p.code)).toEqual([code]);
    expect(await db().select().from(placementValues)).toEqual([]);
    expect(await db().select().from(trackingParameters)).toEqual([]);
    const [{ linked }] = await sql`select count(*)::int as linked from clicks where placement_id is not null`;
    expect(linked).toBe(0);
  });
});
