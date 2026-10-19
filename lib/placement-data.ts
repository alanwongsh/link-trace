import "server-only";

import { asc, eq, sql } from "drizzle-orm";
import { getDb, type Db } from "@/lib/db";
import {
  links,
  placements,
  placementValues,
  trackingParameterOptions as options,
  trackingParameters as parameters,
} from "@/lib/db/schema";
import type { ParameterValue } from "@/lib/parameters";
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

// Creates the placement and its values together. A new random code is tried if one is taken,
// so two people creating placements at the same moment both succeed.
export async function insertPlacement(input: {
  linkId: string;
  name: string | null;
  values: ParameterValue[];
  createdBy: string | null;
  legacyTag?: string | null;
}): Promise<{ id: string; code: string }> {
  for (let attempt = 0; ; attempt += 1) {
    const code = createSlug(PLACEMENT_CODE_LENGTH);
    try {
      return await db().transaction(async (tx) => {
        const [row] = await tx
          .insert(placements)
          .values({ linkId: input.linkId, code, name: input.name, createdBy: input.createdBy, legacyTag: input.legacyTag ?? null })
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

export async function setPlacementActive(id: string, isActive: boolean, updatedBy: string): Promise<void> {
  await db()
    .update(placements)
    .set({ isActive, updatedBy, updatedAt: sql`now()` })
    .where(eq(placements.id, id));
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
