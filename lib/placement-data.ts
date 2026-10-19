import "server-only";

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import {
  links,
  placements,
  placementValues,
  trackingParameterOptions as options,
  trackingParameters as parameters,
} from "@/lib/db/schema";
import type { ParameterValue } from "@/lib/parameters";
import { perPlacementTotals } from "@/lib/report-data";
import { LABEL_KEY_INDEX, labelKey } from "@/lib/label-key";
import { createSlug } from "@/lib/slug";
import type { LinkKind } from "@/lib/types";

// Placement queries throw on database errors; callers in actions turn them into messages.
function db(): Db {
  const config = getDb();
  if (!config.ok) throw new Error(config.message);
  return config.db;
}

function pgError(error: unknown): { code?: string; constraint?: string } {
  const source = error instanceof Error && error.cause instanceof Error ? error.cause : error;
  const { code, constraint_name } = (source ?? {}) as { code?: string; constraint_name?: string };
  return { code, constraint: constraint_name };
}

export const PLACEMENT_CODE_LENGTH = 8;

// Thrown by insertPlacement and setPlacementActive when an active placement of the same link
// already has these labels; code is that placement's, when it can be found.
export class DuplicateLabels extends Error {
  constructor(public code: string | null) {
    super("An active labelled link already has these labels.");
  }
}

// The active placement of a link with this label key, if any.
async function activeWithKey(linkId: string, key: string): Promise<string | null> {
  const [row] = await db()
    .select({ code: placements.code })
    .from(placements)
    .where(and(eq(placements.linkId, linkId), eq(placements.labelKey, key), eq(placements.isActive, true)))
    .limit(1);
  return row?.code ?? null;
}

// Creates the placement and its values together. A new random code is tried if one is taken,
// so two people creating placements at the same moment both succeed. Throws DuplicateLabels if
// an active placement of the link has the same name and labels (the database enforces this).
export async function insertPlacement(input: {
  linkId: string;
  name: string | null;
  values: ParameterValue[];
  createdBy: string | null;
  legacyTag?: string | null;
}): Promise<{ id: string; code: string }> {
  const key = labelKey(input.values, input.name);
  for (let attempt = 0; ; attempt += 1) {
    const code = createSlug(PLACEMENT_CODE_LENGTH);
    try {
      return await db().transaction(async (tx) => {
        const [row] = await tx
          .insert(placements)
          .values({
            linkId: input.linkId,
            code,
            name: input.name,
            createdBy: input.createdBy,
            legacyTag: input.legacyTag ?? null,
            labelKey: key,
          })
          .returning({ id: placements.id, code: placements.code });
        if (input.values.length) {
          await tx.insert(placementValues).values(
            input.values.map((v) => ({ placementId: row.id, parameterId: v.parameterId, optionId: v.optionId, value: v.value })),
          );
        }
        return row;
      });
    } catch (error) {
      const { code: pgCode, constraint } = pgError(error);
      if (pgCode === "23505" && constraint === "placements_code_key" && attempt < 5) continue;
      if (pgCode === "23505" && constraint === LABEL_KEY_INDEX) throw new DuplicateLabels(await activeWithKey(input.linkId, key));
      throw error;
    }
  }
}

export type PlacementRow = {
  id: string;
  code: string;
  name: string | null;
  legacyTag: string | null;
  isActive: boolean;
  createdAt: string;
  clicks: number;
  visitors: number;
  values: { parameterId: string; key: string; name: string; value: string; label: string | null }[];
};

// Every placement of a link with counts from clicks, for scripts and tests. The link page uses
// pagePlacements, which pages and reads the daily totals instead.
export async function listPlacements(linkId: string): Promise<PlacementRow[]> {
  const rows = await db()
    .select({
      id: placements.id,
      code: placements.code,
      name: placements.name,
      legacyTag: placements.legacyTag,
      isActive: placements.isActive,
      createdAt: placements.createdAt,
      clicks: sql<number>`(select count(*)::int from clicks c where c.placement_id = placements.id and not c.is_bot)`,
      visitors: sql<number>`(select count(distinct c.visitor_id)::int from clicks c where c.placement_id = placements.id and not c.is_bot)`,
    })
    .from(placements)
    .where(eq(placements.linkId, linkId))
    .orderBy(asc(placements.createdAt));
  if (rows.length === 0) return [];

  const values = await db()
    .select({
      placementId: placementValues.placementId,
      parameterId: placementValues.parameterId,
      key: parameters.key,
      name: parameters.name,
      value: placementValues.value,
      label: options.label,
    })
    .from(placementValues)
    .innerJoin(placements, eq(placements.id, placementValues.placementId))
    .innerJoin(parameters, eq(parameters.id, placementValues.parameterId))
    .leftJoin(options, eq(options.id, placementValues.optionId))
    .where(eq(placements.linkId, linkId))
    .orderBy(asc(parameters.sortOrder), asc(parameters.createdAt));

  return rows.map((row) => ({
    ...row,
    values: values.filter((v) => v.placementId === row.id).map(({ placementId: _, ...v }) => v),
  }));
}

// The label keys of a link's active placements, with each one's code. Inactive placements are
// left out, so a deactivated one can be replaced by a new one with the same labels.
export async function activeLabelKeys(linkId: string): Promise<Map<string, string>> {
  const rows = await db()
    .select({
      id: placements.id,
      code: placements.code,
      name: placements.name,
      parameterId: placementValues.parameterId,
      value: placementValues.value,
    })
    .from(placements)
    .leftJoin(placementValues, eq(placementValues.placementId, placements.id))
    .where(and(eq(placements.linkId, linkId), eq(placements.isActive, true)));
  const byPlacement = new Map<string, { code: string; name: string | null; values: { parameterId: string; value: string }[] }>();
  for (const row of rows) {
    const entry = byPlacement.get(row.id) ?? { code: row.code, name: row.name, values: [] };
    if (row.parameterId && row.value !== null) entry.values.push({ parameterId: row.parameterId, value: row.value });
    byPlacement.set(row.id, entry);
  }
  return new Map([...byPlacement.values()].map((p) => [labelKey(p.values, p.name), p.code]));
}

// Splits rows into new ones and ones that match an active placement (or an earlier row).
export async function withoutExisting<T extends { name?: string | null; values: { parameterId: string; value: string }[] }>(
  linkId: string,
  rows: T[],
): Promise<{ fresh: T[]; existing: { row: T; code: string | null }[] }> {
  const taken = await activeLabelKeys(linkId);
  const seen = new Set<string>();
  const fresh: T[] = [];
  const existing: { row: T; code: string | null }[] = [];
  for (const row of rows) {
    const key = labelKey(row.values, row.name);
    if (taken.has(key)) existing.push({ row, code: taken.get(key)! });
    else if (seen.has(key)) existing.push({ row, code: null });
    else {
      seen.add(key);
      fresh.push(row);
    }
  }
  return { fresh, existing };
}

export type PlacementStatus = "all" | "active" | "inactive";

export async function countPlacements(linkId: string): Promise<number> {
  const [row] = await db().select({ n: sql<number>`count(*)::int` }).from(placements).where(eq(placements.linkId, linkId));
  return row?.n ?? 0;
}

// One page of a link's placements, newest first, for the link page. q matches the code, the name,
// or any label value or option label. Counts come from the daily totals (all time), not a scan of
// clicks per row.
export async function pagePlacements(
  linkId: string,
  query: { q?: string; status?: PlacementStatus; limit: number; offset: number },
): Promise<{ rows: PlacementRow[]; total: number }> {
  const q = query.q?.trim();
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const filters = sql.join(
    [
      sql`p.link_id = ${linkId}`,
      query.status === "active" ? sql`p.is_active` : query.status === "inactive" ? sql`not p.is_active` : sql`true`,
      pattern
        ? sql`(p.code ilike ${pattern} or p.name ilike ${pattern} or exists (
            select 1 from placement_values v left join tracking_parameter_options o on o.id = v.option_id
            where v.placement_id = p.id and (v.value ilike ${pattern} or o.label ilike ${pattern})))`
        : sql`true`,
    ],
    sql` and `,
  );

  const rows = await db().execute<{
    id: string;
    code: string;
    name: string | null;
    legacy_tag: string | null;
    is_active: boolean;
    created_at: string;
    clicks: number | null;
    visitors: number | null;
    total: number;
  }>(sql`
    with t as (${perPlacementTotals(linkId, null)})
    select p.id, p.code, p.name, p.legacy_tag, p.is_active, p.created_at::text as created_at,
      t.clicks, t.visitors, count(*) over ()::int as total
    from placements p left join t on t.placement_id = p.id
    where ${filters}
    order by p.created_at desc, p.id desc
    limit ${query.limit} offset ${query.offset}`);
  const page = [...rows];
  if (page.length === 0) {
    // Past the last page still reports the total, so the pager can offer a way back.
    const [{ total }] = await db().execute<{ total: number }>(sql`select count(*)::int as total from placements p where ${filters}`);
    return { rows: [], total };
  }

  const values = await db()
    .select({
      placementId: placementValues.placementId,
      parameterId: placementValues.parameterId,
      key: parameters.key,
      name: parameters.name,
      value: placementValues.value,
      label: options.label,
    })
    .from(placementValues)
    .innerJoin(parameters, eq(parameters.id, placementValues.parameterId))
    .leftJoin(options, eq(options.id, placementValues.optionId))
    .where(inArray(placementValues.placementId, page.map((r) => r.id)))
    .orderBy(asc(parameters.sortOrder), asc(parameters.createdAt));

  return {
    total: page[0].total,
    rows: page.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      legacyTag: row.legacy_tag,
      isActive: row.is_active,
      createdAt: row.created_at,
      clicks: row.clicks ?? 0,
      visitors: row.visitors ?? 0,
      values: values.filter((v) => v.placementId === row.id).map(({ placementId: _, ...v }) => v),
    })),
  };
}

// A placement with the workspace of its link, for permission checks.
export async function findPlacement(id: string) {
  const [row] = await db()
    .select({
      id: placements.id,
      code: placements.code,
      name: placements.name,
      isActive: placements.isActive,
      linkId: placements.linkId,
      slug: links.slug,
      workspaceId: links.workspaceId,
    })
    .from(placements)
    .innerJoin(links, eq(links.id, placements.linkId))
    .where(eq(placements.id, id))
    .limit(1);
  return row ?? null;
}

// Activating sets the label key too (older duplicates have none), so it throws DuplicateLabels when
// another active placement of the link already has the same name and labels.
export async function setPlacementActive(id: string, isActive: boolean, updatedBy: string): Promise<void> {
  const [placement] = await db()
    .select({ linkId: placements.linkId, name: placements.name })
    .from(placements)
    .where(eq(placements.id, id));
  if (!placement) return;
  const values = isActive
    ? await db()
        .select({ parameterId: placementValues.parameterId, value: placementValues.value })
        .from(placementValues)
        .where(eq(placementValues.placementId, id))
    : [];
  const key = labelKey(values, placement.name);
  try {
    await db()
      .update(placements)
      .set({ isActive, updatedBy, updatedAt: sql`now()`, ...(isActive ? { labelKey: key } : {}) })
      .where(eq(placements.id, id));
  } catch (error) {
    const { code, constraint } = pgError(error);
    if (code === "23505" && constraint === LABEL_KEY_INDEX) throw new DuplicateLabels(await activeWithKey(placement.linkId, key));
    throw error;
  }
}

export async function linkHasPlacements(linkId: string): Promise<boolean> {
  const [row] = await db().select({ id: placements.id }).from(placements).where(eq(placements.linkId, linkId)).limit(1);
  return Boolean(row);
}

export type PlacementDestination = {
  placementId: string;
  linkId: string;
  legacyTag: string | null;
  kind: LinkKind;
  url: string | null;
  html: string | null;
};

// For /q/<code>. Inactive placements still resolve: their codes may already be printed.
export async function findPlacementDestination(code: string): Promise<PlacementDestination | null> {
  const [row] = await db()
    .select({
      placementId: placements.id,
      linkId: links.id,
      legacyTag: placements.legacyTag,
      kind: links.kind,
      url: links.url,
      html: links.html,
    })
    .from(placements)
    .innerJoin(links, eq(links.id, placements.linkId))
    .where(eq(placements.code, code))
    .limit(1);
  return row ?? null;
}
