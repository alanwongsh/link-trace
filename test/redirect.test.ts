import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clicks, links } from "@/lib/db/schema";
import { VISITOR_COOKIE } from "@/lib/session";
import { createUser, createWorkspace, db, resetData } from "./helpers";

// after() needs a Next.js request scope; run the task here and let tests wait for it.
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

const { GET: plainRoute } = await import("@/app/r/[slug]/route");
const { GET: tagRoute } = await import("@/app/r/[slug]/[tag]/route");

const BROWSER = {
  "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36",
  "sec-fetch-mode": "navigate",
};

async function visit(path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  const request = new NextRequest(`http://localhost${path}`, {
    method: init.method ?? "GET",
    headers: { ...BROWSER, ...init.headers },
  });
  const [, , slug, tag] = path.split("/");
  const response = tag
    ? await tagRoute(request, { params: Promise.resolve({ slug, tag }) })
    : await plainRoute(request, { params: Promise.resolve({ slug }) });
  await Promise.all(pending.splice(0));
  return response;
}

async function clicksFor(slug: string) {
  return db()
    .select({ tag: clicks.tag, isBot: clicks.isBot, visitorId: clicks.visitorId })
    .from(clicks)
    .innerJoin(links, eq(links.id, clicks.linkId))
    .where(eq(links.slug, slug));
}

beforeEach(async () => {
  await resetData();
  const workspaceId = await createWorkspace();
  const user = await createUser({ [workspaceId]: "owner" });
  await db().insert(links).values([
    { slug: "promo", url: "https://example.com/promo", tags: ["email", "lark"], workspaceId, createdBy: user.id },
    { slug: "plain", url: "https://example.com/plain", workspaceId, createdBy: user.id },
    { slug: "hosted", kind: "page", html: "<h1>Thanks</h1>", workspaceId, createdBy: user.id },
  ]);
});

describe("/r/<slug>", () => {
  it("redirects and records an untagged click", async () => {
    const response = await visit("/r/promo");
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://example.com/promo");
    expect(await clicksFor("promo")).toEqual([expect.objectContaining({ tag: null, isBot: false })]);
  });

  it("matches the slug regardless of case", async () => {
    expect((await visit("/r/PROMO")).status).toBe(302);
  });

  it("sets a visitor cookie once and reuses it", async () => {
    const first = await visit("/r/promo");
    const visitorId = first.cookies.get(VISITOR_COOKIE)?.value;
    expect(visitorId).toBeTruthy();

    const second = await visit("/r/promo", { headers: { cookie: `${VISITOR_COOKIE}=${visitorId}` } });
    expect(second.cookies.get(VISITOR_COOKIE)).toBeUndefined();
    expect((await clicksFor("promo")).map((c) => c.visitorId)).toEqual([visitorId, visitorId]);
  });

  it("returns 404 for an unknown slug", async () => {
    expect((await visit("/r/missing")).status).toBe(404);
  });

  it("serves a hosted page", async () => {
    const response = await visit("/r/hosted");
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("<h1>Thanks</h1>");
    expect(await clicksFor("hosted")).toHaveLength(1);
  });

  it("does not record HEAD requests or prefetches", async () => {
    expect((await visit("/r/promo", { method: "HEAD" })).status).toBe(302);
    expect((await visit("/r/promo", { headers: { purpose: "prefetch" } })).status).toBe(302);
    expect(await clicksFor("promo")).toHaveLength(0);
  });

  it("records bots but flags them", async () => {
    await visit("/r/promo", { headers: { "user-agent": "facebookexternalhit/1.1" } });
    expect(await clicksFor("promo")).toEqual([expect.objectContaining({ isBot: true })]);
  });
});

describe("/r/<slug>/<tag>", () => {
  it("redirects and records the tag, for each tag on the link", async () => {
    expect((await visit("/r/promo/email")).headers.get("location")).toBe("https://example.com/promo");
    expect((await visit("/r/promo/LARK")).status).toBe(302);
    expect((await clicksFor("promo")).map((c) => c.tag).sort()).toEqual(["email", "lark"]);
  });

  it("returns 404 for a tag that is not on the link, without recording", async () => {
    expect((await visit("/r/promo/whatsapp")).status).toBe(404);
    expect((await visit("/r/plain/email")).status).toBe(404);
    expect((await visit("/r/promo/bad_tag")).status).toBe(404);
    expect(await clicksFor("promo")).toHaveLength(0);
  });
});
