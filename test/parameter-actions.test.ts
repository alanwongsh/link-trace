import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionUser } from "@/lib/accounts";
import { auditLog, trackingParameterOptions, trackingParameters } from "@/lib/db/schema";
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
  };
});
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const actions = await import("@/lib/parameter-actions");
const data = await import("@/lib/parameter-data");
const { validateParameterValues } = await import("@/lib/parameters");

const empty = { error: "", ok: "" };
let workspaceId: string;
let otherWorkspaceId: string;

async function create(values: Record<string, string>, workspace = workspaceId) {
  return actions.createParameter(empty, form({ workspace_id: workspace, field_type: "text", ...values }));
}

async function parameterByKey(key: string, workspace = workspaceId) {
  const rows = await data.listParameters(workspace);
  return rows.find((row) => row.key === key)!;
}

beforeEach(async () => {
  await resetData();
  workspaceId = await createWorkspace();
  otherWorkspaceId = await createWorkspace();
  session.user = await createUser({ [workspaceId]: "viewer" });
});

describe("parameters", () => {
  it("creates parameters in display order, with an audit entry", async () => {
    expect(await create({ name: "Store Code", key: "store_code", field_type: "dropdown", is_required: "on" })).toEqual({
      error: "",
      ok: "Added Store Code.",
    });
    await create({ name: "Booth", key: "booth_id" });
    const rows = await data.listParameters(workspaceId);
    expect(rows.map((r) => [r.key, r.fieldType, r.isRequired, r.isActive, r.sortOrder])).toEqual([
      ["store_code", "dropdown", true, true, 0],
      ["booth_id", "text", false, true, 1],
    ]);
    expect(await db().select().from(auditLog).where(eq(auditLog.action, "parameter.create"))).toHaveLength(2);
  });

  it("lets any workspace member manage parameters for now", async () => {
    for (const role of ["viewer", "editor", "owner"] as const) {
      session.user = await createUser({ [workspaceId]: role });
      expect((await create({ name: role, key: `by_${role}` })).error).toBe("");
    }
  });

  it("rejects duplicate keys in a workspace, regardless of case, but allows them in another", async () => {
    await create({ name: "Store", key: "store_code" });
    expect((await create({ name: "Store 2", key: "STORE_CODE" })).error).toBe(
      "The key store_code is already used in this workspace.",
    );
    session.user = await createUser({ [workspaceId]: "viewer", [otherWorkspaceId]: "viewer" });
    expect((await create({ name: "Store", key: "store_code" }, otherWorkspaceId)).error).toBe("");
  });

  it("rejects invalid keys and field types", async () => {
    expect((await create({ name: "Store", key: "store code" })).error).toMatch(/^Keys start with a letter/);
    expect((await create({ name: "Store", key: "store", field_type: "number" })).error).toBe("Choose a field type.");
  });

  it("renames without changing the key or field type", async () => {
    await create({ name: "Store", key: "store_code", field_type: "dropdown" });
    const { id } = await parameterByKey("store_code");
    const result = await actions.editParameter(
      empty,
      form({ parameter_id: id, name: "Outlet", description: "Branch code", key: "outlet", field_type: "text", is_required: "on" }),
    );
    expect(result.error).toBe("");
    const [row] = await db().select().from(trackingParameters).where(eq(trackingParameters.id, id));
    expect(row).toMatchObject({ name: "Outlet", key: "store_code", fieldType: "dropdown", isRequired: true, description: "Branch code" });
  });

  it("deactivates and reactivates instead of deleting", async () => {
    await create({ name: "Store", key: "store_code" });
    const { id } = await parameterByKey("store_code");
    await actions.setParameterStatus(empty, form({ parameter_id: id, is_active: "false" }));
    expect((await parameterByKey("store_code")).isActive).toBe(false);
    await actions.setParameterStatus(empty, form({ parameter_id: id, is_active: "true" }));
    expect((await parameterByKey("store_code")).isActive).toBe(true);
  });

  it("reorders", async () => {
    await create({ name: "A", key: "a" });
    await create({ name: "B", key: "b" });
    await create({ name: "C", key: "c" });
    const { id } = await parameterByKey("c");
    await actions.reorderParameter(empty, form({ parameter_id: id, direction: "up" }));
    expect((await data.listParameters(workspaceId)).map((r) => r.key)).toEqual(["a", "c", "b"]);
    await actions.reorderParameter(empty, form({ parameter_id: (await parameterByKey("a")).id, direction: "up" }));
    expect((await data.listParameters(workspaceId)).map((r) => r.key)).toEqual(["a", "c", "b"]);
  });

  it("keeps creates consistent when they run at the same time", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, (_, i) => create({ name: `P${i}`, key: i < 4 ? "same" : `key_${i}` })),
    );
    expect(results.filter((r) => r.error === "")).toHaveLength(5);
    const orders = (await data.listParameters(workspaceId)).map((r) => r.sortOrder);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe("workspace isolation", () => {
  it("does not let members of one workspace see or change another's parameters", async () => {
    session.user = await createUser({ [otherWorkspaceId]: "owner" });
    await create({ name: "Secret", key: "secret" }, otherWorkspaceId);
    const { id } = await parameterByKey("secret", otherWorkspaceId);

    session.user = await createUser({ [workspaceId]: "owner" });
    expect((await create({ name: "X", key: "x" }, otherWorkspaceId)).error).toBe(
      "You cannot manage parameters in that workspace.",
    );
    const attempts = [
      actions.editParameter(empty, form({ parameter_id: id, name: "Hacked" })),
      actions.setParameterStatus(empty, form({ parameter_id: id, is_active: "false" })),
      actions.importOptions(empty, form({ parameter_id: id, options: "A" })),
      actions.reorderParameter(empty, form({ parameter_id: id, direction: "up" })),
    ];
    for (const result of await Promise.all(attempts)) {
      expect(result.error).toBe("That parameter could not be found.");
    }
    expect((await parameterByKey("secret", otherWorkspaceId)).name).toBe("Secret");
  });

  it("lets org admins manage any workspace", async () => {
    session.user = await createUser({}, { isOrgAdmin: true });
    expect((await create({ name: "Store", key: "store_code" }, otherWorkspaceId)).error).toBe("");
  });

  it("rejects a workspace id that does not exist", async () => {
    session.user = await createUser({}, { isOrgAdmin: true });
    const result = await create({ name: "Store", key: "store" }, "00000000-0000-7000-8000-000000000000");
    expect(result.error).toBe("You cannot manage parameters in that workspace.");
  });
});

describe("dropdown options", () => {
  let parameterId: string;

  beforeEach(async () => {
    await create({ name: "Store", key: "store_code", field_type: "dropdown", is_required: "on" });
    parameterId = (await parameterByKey("store_code")).id;
  });

  async function options() {
    return (await data.listOptions(parameterId)).rows;
  }

  it("imports options and skips ones that already exist, regardless of case", async () => {
    const first = await actions.importOptions(empty, form({ parameter_id: parameterId, options: "value,label\nKL001,Mid Valley\nPG002" }));
    expect(first).toEqual({ error: "", ok: "Added 2 options." });
    const second = await actions.importOptions(empty, form({ parameter_id: parameterId, options: "kl001\nJB003" }));
    expect(second).toEqual({ error: "", ok: "Added 1 option. 1 already existed and were skipped." });
    expect((await options()).map((o) => [o.value, o.label, o.sortOrder])).toEqual([
      ["KL001", "Mid Valley", 0],
      ["PG002", null, 1],
      ["JB003", null, 2],
    ]);
  });

  it("enforces unique values in the database too", async () => {
    await actions.importOptions(empty, form({ parameter_id: parameterId, options: "KL001" }));
    await expect(
      db().insert(trackingParameterOptions).values({ parameterId, value: "kl001" }),
    ).rejects.toThrow();
  });

  it("does not add options to text parameters", async () => {
    await create({ name: "Note", key: "note" });
    const note = await parameterByKey("note");
    expect((await actions.importOptions(empty, form({ parameter_id: note.id, options: "A" }))).error).toBe(
      "Only dropdown parameters have options.",
    );
  });

  it("edits labels, deactivates and reorders options, keeping the value fixed", async () => {
    await actions.importOptions(empty, form({ parameter_id: parameterId, options: "A\nB" }));
    const [a, b] = await options();
    await actions.editOption(empty, form({ option_id: a.id, label: "Alpha", value: "Z" }));
    await actions.setOptionStatus(empty, form({ option_id: b.id, is_active: "false" }));
    await actions.reorderOption(empty, form({ option_id: b.id, direction: "up" }));
    expect((await options()).map((o) => [o.value, o.label, o.isActive])).toEqual([
      ["B", null, false],
      ["A", "Alpha", true],
    ]);
  });

  it("searches and pages options", async () => {
    const lines = Array.from({ length: 30 }, (_, i) => `S${String(i).padStart(3, "0")},Store ${i}`).join("\n");
    await actions.importOptions(empty, form({ parameter_id: parameterId, options: lines }));
    const page = await data.listOptions(parameterId, { limit: 10, offset: 10 });
    expect(page.total).toBe(30);
    expect(page.rows.map((r) => r.value)[0]).toBe("S010");
    expect((await data.listOptions(parameterId, { search: "store 2" })).total).toBe(11);
    expect((await data.listOptions(parameterId, { search: "%" })).total).toBe(0);
  });

  it("hides other workspaces' options", async () => {
    await actions.importOptions(empty, form({ parameter_id: parameterId, options: "A" }));
    const [a] = await options();
    session.user = await createUser({ [otherWorkspaceId]: "owner" });
    expect((await actions.editOption(empty, form({ option_id: a.id, label: "x" }))).error).toBe(
      "That option could not be found.",
    );
  });

  it("validates values against the stored definitions", async () => {
    await actions.importOptions(empty, form({ parameter_id: parameterId, options: "KL001\nOLD" }));
    const old = (await options()).find((o) => o.value === "OLD")!;
    await actions.setOptionStatus(empty, form({ option_id: old.id, is_active: "false" }));

    const definitions = await data.parameterDefinitions(workspaceId);
    expect(validateParameterValues(definitions, { store_code: "kl001" })).toMatchObject({
      ok: true,
      values: [{ key: "store_code", value: "KL001" }],
    });
    expect(validateParameterValues(definitions, { store_code: "OLD" }).ok).toBe(false);
    expect(validateParameterValues(definitions, {}).ok).toBe(false);
    expect(validateParameterValues(await data.parameterDefinitions(otherWorkspaceId), {}).ok).toBe(true);
  });
});
