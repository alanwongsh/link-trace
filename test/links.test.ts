import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/accounts";
import { auditLog, clicks, links } from "@/lib/db/schema";
import { createUser, createWorkspace, db, form, resetData } from "./helpers";

// Server actions read the signed-in user from cookies; tests choose the user directly.
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

const { addTags, createLink } = await import("@/lib/actions");
const { listLinks, loadDetail } = await import("@/lib/data");

let workspaceId: string;
let otherWorkspaceId: string;

async function linkRow(slug: string) {
  const [row] = await db().select().from(links).where(eq(links.slug, slug));
  return row;
}

beforeEach(async () => {
  await resetData();
  workspaceId = await createWorkspace();
  otherWorkspaceId = await createWorkspace();
});

describe("creating links", () => {
  it("creates a redirect link with several tags", async () => {
    session.user = await createUser({ [workspaceId]: "editor" });
    const result = await createLink(
      { error: "", slug: "" },
      form({ workspace_id: workspaceId, url: "https://example.com", slug: "launch", tags: "email, lark, other-tag" }),
    );
    expect(result).toEqual({ error: "", slug: "launch" });
    const row = await linkRow("launch");
    expect(row).toMatchObject({ kind: "redirect", url: "https://example.com/", tags: ["email", "lark", "other-tag"], workspaceId });
    const entries = await db().select().from(auditLog).where(eq(auditLog.action, "link.create"));
    expect(entries).toHaveLength(1);
  });

  it("creates a link with no tags and a generated slug", async () => {
    session.user = await createUser({ [workspaceId]: "editor" });
    const result = await createLink({ error: "", slug: "" }, form({ workspace_id: workspaceId, url: "https://example.com" }));
    expect(result.error).toBe("");
    expect((await linkRow(result.slug)).tags).toEqual([]);
  });

  it("rejects a slug that is already used", async () => {
    session.user = await createUser({ [workspaceId]: "editor" });
    const input = { workspace_id: workspaceId, url: "https://example.com", slug: "taken" };
    await createLink({ error: "", slug: "" }, form(input));
    expect((await createLink({ error: "", slug: "" }, form(input))).error).toBe("That slug is already in use.");
  });

  it("rejects unsafe destination URLs", async () => {
    session.user = await createUser({ [workspaceId]: "editor" });
    const result = await createLink({ error: "", slug: "" }, form({ workspace_id: workspaceId, url: "javascript:alert(1)" }));
    expect(result.error).not.toBe("");
  });

  it("does not let viewers or non-members create links", async () => {
    session.user = await createUser({ [workspaceId]: "viewer" });
    const input = form({ workspace_id: workspaceId, url: "https://example.com", slug: "nope" });
    expect((await createLink({ error: "", slug: "" }, input)).error).toBe("You cannot create links in that workspace.");

    session.user = await createUser({ [workspaceId]: "editor" });
    const other = form({ workspace_id: otherWorkspaceId, url: "https://example.com", slug: "nope" });
    expect((await createLink({ error: "", slug: "" }, other)).error).toBe("You cannot create links in that workspace.");
    expect(await linkRow("nope")).toBeUndefined();
  });

  it("lets only owners publish hosted pages", async () => {
    const page = { workspace_id: workspaceId, kind: "page", html: "<p>Hi</p>", slug: "page-1" };
    session.user = await createUser({ [workspaceId]: "editor" });
    expect((await createLink({ error: "", slug: "" }, form(page))).error).toBe("Only workspace owners can publish hosted pages.");
    session.user = await createUser({ [workspaceId]: "owner" });
    expect((await createLink({ error: "", slug: "" }, form(page))).error).toBe("");
  });
});

describe("adding tags", () => {
  beforeEach(async () => {
    session.user = await createUser({ [workspaceId]: "editor" });
    await createLink(
      { error: "", slug: "" },
      form({ workspace_id: workspaceId, url: "https://example.com", slug: "tagged", tags: "email" }),
    );
  });

  it("appends new tags and keeps existing ones", async () => {
    const result = await addTags({ error: "", added: "" }, form({ slug: "tagged", tags: "lark, email" }));
    expect(result.error).toBe("");
    expect((await linkRow("tagged")).tags).toEqual(["email", "lark"]);
  });

  it("rejects tags that are all already on the link", async () => {
    const result = await addTags({ error: "", added: "" }, form({ slug: "tagged", tags: "email" }));
    expect(result.error).toBe("Those tags are already on this link.");
  });

  it("enforces the tag limit", async () => {
    const many = Array.from({ length: 12 }, (_, i) => `t${i}`).join(",");
    const result = await addTags({ error: "", added: "" }, form({ slug: "tagged", tags: many }));
    expect(result.error).toBe("A link can have up to 12 tags.");
  });

  it("does not let viewers add tags", async () => {
    session.user = await createUser({ [workspaceId]: "viewer" });
    const result = await addTags({ error: "", added: "" }, form({ slug: "tagged", tags: "lark" }));
    expect(result.error).toBe("You need the editor role in this workspace to do that.");
  });

  it("hides links in other workspaces", async () => {
    session.user = await createUser({ [otherWorkspaceId]: "owner" });
    const result = await addTags({ error: "", added: "" }, form({ slug: "tagged", tags: "lark" }));
    expect(result.error).toBe("That link could not be found.");
  });
});

describe("stats", () => {
  it("counts clicks per tag, untagged clicks and bots", async () => {
    session.user = await createUser({ [workspaceId]: "editor" });
    await createLink(
      { error: "", slug: "" },
      form({ workspace_id: workspaceId, url: "https://example.com", slug: "stats", tags: "email, lark" }),
    );
    const { id: linkId } = await linkRow("stats");
    await db().insert(clicks).values([
      { linkId, visitorId: "v1", tag: "email" },
      { linkId, visitorId: "v1", tag: "email" },
      { linkId, visitorId: "v2", tag: "lark" },
      { linkId, visitorId: "v3", tag: null },
      { linkId, visitorId: "bot", tag: null, isBot: true },
    ]);

    const detail = await loadDetail("stats");
    expect(detail.ok).toBe(true);
    const data = detail.ok ? detail.data! : null;
    const byTag = Object.fromEntries((data?.tag_stats ?? []).map((t) => [t.tag, t]));
    expect(byTag.email).toMatchObject({ clicks: 2, visitors: 1 });
    expect(byTag.lark).toMatchObject({ clicks: 1, visitors: 1 });
    expect(data?.bot_clicks).toBe(1);

    const listed = await listLinks({ workspaceIds: [workspaceId] });
    expect(listed.ok && listed.data.map((l) => l.slug)).toEqual(["stats"]);
    const other = await listLinks({ workspaceIds: [otherWorkspaceId] });
    expect(other.ok && other.data).toEqual([]);
  });
});
