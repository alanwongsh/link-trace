import "server-only";

import { and, asc, count, desc, eq, gt, ilike, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import { trackingParameterOptions as options, trackingParameters as parameters } from "@/lib/db/schema";
import { MAX_OPTIONS, MAX_PARAMETERS, type OptionRow, type ParameterDefinition, type ParameterInput, type ParameterType } from "@/lib/parameters";

// Parameter queries throw on database errors; callers in actions turn them into messages.
function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

function pgCode(error: unknown): string | undefined {
  const source = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  return (source as { code?: string } | null)?.code;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

// ---- Parameters ----

export async function listParameters(workspaceId: string) {
  return db()
    .select({
      id: parameters.id,
      workspaceId: parameters.workspaceId,
      name: parameters.name,
      key: parameters.key,
      description: parameters.description,
      fieldType: parameters.fieldType,
      isRequired: parameters.isRequired,
      isActive: parameters.isActive,
      sortOrder: parameters.sortOrder,
      updatedAt: parameters.updatedAt,
      optionCount: sql<number>`(select count(*)::int from ${options} where ${options.parameterId} = ${parameters.id} and ${options.isActive})`,
    })
    .from(parameters)
    .where(eq(parameters.workspaceId, workspaceId))
    .orderBy(asc(parameters.sortOrder), asc(parameters.createdAt));
}

export async function findParameter(id: string) {
  const [row] = await db().select().from(parameters).where(eq(parameters.id, id)).limit(1);
  return row ?? null;
}

export async function insertParameter(input: ParameterInput & {
  workspaceId: string;
  key: string;
  fieldType: ParameterType;
  createdBy: string;
}): Promise<{ id: string } | "duplicate" | "too-many" | "no-workspace"> {
  try {
    return await db().transaction(async (tx) => {
      // Serializes creates per workspace, so the count limit and sort order stay consistent.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`parameters:${input.workspaceId}`}))`);
      const [{ total, last }] = await tx
        .select({ total: count(), last: sql<number | null>`max(${parameters.sortOrder})` })
        .from(parameters)
        .where(eq(parameters.workspaceId, input.workspaceId));
      if (total >= MAX_PARAMETERS) return "too-many" as const;
      const [row] = await tx
        .insert(parameters)
        .values({ ...input, sortOrder: (last ?? -1) + 1 })
        .returning({ id: parameters.id });
      return row;
    });
  } catch (error) {
    if (pgCode(error) === "23505") return "duplicate";
    if (pgCode(error) === "23503") return "no-workspace";
    throw error;
  }
}

// The key and field type are fixed after creation, so they cannot be changed here.
export async function updateParameter(id: string, input: ParameterInput, updatedBy: string): Promise<void> {
  await db()
    .update(parameters)
    .set({ ...input, updatedBy, updatedAt: sql`now()` })
    .where(eq(parameters.id, id));
}

export async function setParameterActive(id: string, isActive: boolean, updatedBy: string): Promise<void> {
  await db()
    .update(parameters)
    .set({ isActive, updatedBy, updatedAt: sql`now()` })
    .where(eq(parameters.id, id));
}

export async function moveParameter(id: string, direction: "up" | "down"): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [current] = await tx.select().from(parameters).where(eq(parameters.id, id)).for("update");
    if (!current) return false;
    const [neighbour] = await tx
      .select({ id: parameters.id, sortOrder: parameters.sortOrder })
      .from(parameters)
      .where(
        and(
          eq(parameters.workspaceId, current.workspaceId),
          direction === "up" ? lt(parameters.sortOrder, current.sortOrder) : gt(parameters.sortOrder, current.sortOrder),
        ),
      )
      .orderBy(direction === "up" ? desc(parameters.sortOrder) : asc(parameters.sortOrder))
      .limit(1)
      .for("update");
    if (!neighbour) return false;
    await swap(tx, parameters, current, neighbour);
    return true;
  });
}

// Everything validateParameterValues() needs for a workspace, including inactive rows.
export async function parameterDefinitions(workspaceId: string): Promise<ParameterDefinition[]> {
  const rows = await db()
    .select({
      id: parameters.id,
      key: parameters.key,
      name: parameters.name,
      fieldType: parameters.fieldType,
      isRequired: parameters.isRequired,
      isActive: parameters.isActive,
    })
    .from(parameters)
    .where(eq(parameters.workspaceId, workspaceId))
    .orderBy(asc(parameters.sortOrder), asc(parameters.createdAt));
  const dropdownIds = rows.filter((r) => r.fieldType === "dropdown").map((r) => r.id);
  const optionRows = dropdownIds.length
    ? await db()
        .select({ id: options.id, parameterId: options.parameterId, value: options.value, isActive: options.isActive })
        .from(options)
        .where(inArray(options.parameterId, dropdownIds))
        .orderBy(asc(options.sortOrder), asc(options.createdAt))
    : [];
  return rows.map((row) => ({
    ...row,
    options: optionRows.filter((o) => o.parameterId === row.id).map(({ parameterId: _, ...o }) => o),
  }));
}

// ---- Options ----

export async function listOptions(
  parameterId: string,
  filter: { search?: string; limit?: number; offset?: number } = {},
) {
  const conditions: SQL[] = [eq(options.parameterId, parameterId)];
  const search = filter.search?.trim();
  if (search) {
    const pattern = `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    conditions.push(or(ilike(options.value, pattern), ilike(options.label, pattern))!);
  }
  const where = and(...conditions);
  const [rows, [{ total }]] = await Promise.all([
    db()
      .select({
        id: options.id,
        value: options.value,
        label: options.label,
        isActive: options.isActive,
        sortOrder: options.sortOrder,
      })
      .from(options)
      .where(where)
      .orderBy(asc(options.sortOrder), asc(options.createdAt))
      .limit(filter.limit ?? 100)
      .offset(filter.offset ?? 0),
    db().select({ total: count() }).from(options).where(where),
  ]);
  return { rows, total };
}

export async function findOption(id: string) {
  const [row] = await db()
    .select({
      id: options.id,
      parameterId: options.parameterId,
      value: options.value,
      label: options.label,
      isActive: options.isActive,
      workspaceId: parameters.workspaceId,
    })
    .from(options)
    .innerJoin(parameters, eq(parameters.id, options.parameterId))
    .where(eq(options.id, id))
    .limit(1);
  return row ?? null;
}

// Adds new values in one transaction. Values already on the parameter (in any case) are skipped
// and reported, so an updated list can be imported again.
export async function addOptions(
  parameterId: string,
  rows: OptionRow[],
  createdBy: string,
): Promise<{ added: number; skipped: string[] } | "too-many"> {
  return db().transaction(async (tx) => {
    // Locks the parameter so two imports cannot interleave.
    await tx.select({ id: parameters.id }).from(parameters).where(eq(parameters.id, parameterId)).for("update");
    const existing = await tx
      .select({ value: options.value, sortOrder: options.sortOrder })
      .from(options)
      .where(eq(options.parameterId, parameterId));
    const taken = new Set(existing.map((o) => o.value.toLowerCase()));
    const fresh = rows.filter((row) => !taken.has(row.value.toLowerCase()));
    const skipped = rows.filter((row) => taken.has(row.value.toLowerCase())).map((row) => row.value);
    if (existing.length + fresh.length > MAX_OPTIONS) return "too-many" as const;

    let next = existing.reduce((max, o) => Math.max(max, o.sortOrder), -1) + 1;
    for (let start = 0; start < fresh.length; start += 500) {
      await tx.insert(options).values(
        fresh.slice(start, start + 500).map((row) => ({ parameterId, ...row, sortOrder: next++, createdBy })),
      );
    }
    return { added: fresh.length, skipped };
  });
}

// The value is the code that placements and reports use, so only the label can change.
export async function updateOptionLabel(id: string, label: string | null, updatedBy: string): Promise<void> {
  await db().update(options).set({ label, updatedBy, updatedAt: sql`now()` }).where(eq(options.id, id));
}

export async function setOptionActive(id: string, isActive: boolean, updatedBy: string): Promise<void> {
  await db().update(options).set({ isActive, updatedBy, updatedAt: sql`now()` }).where(eq(options.id, id));
}

export async function moveOption(id: string, direction: "up" | "down"): Promise<boolean> {
  return db().transaction(async (tx) => {
    const [current] = await tx.select().from(options).where(eq(options.id, id)).for("update");
    if (!current) return false;
    const [neighbour] = await tx
      .select({ id: options.id, sortOrder: options.sortOrder })
      .from(options)
      .where(
        and(
          eq(options.parameterId, current.parameterId),
          direction === "up" ? lt(options.sortOrder, current.sortOrder) : gt(options.sortOrder, current.sortOrder),
        ),
      )
      .orderBy(direction === "up" ? desc(options.sortOrder) : asc(options.sortOrder))
      .limit(1)
      .for("update");
    if (!neighbour) return false;
    await swap(tx, options, current, neighbour);
    return true;
  });
}

async function swap(
  tx: Tx,
  table: typeof parameters | typeof options,
  a: { id: string; sortOrder: number },
  b: { id: string; sortOrder: number },
): Promise<void> {
  await tx.update(table).set({ sortOrder: b.sortOrder }).where(eq(table.id, a.id));
  await tx.update(table).set({ sortOrder: a.sortOrder }).where(eq(table.id, b.id));
}
