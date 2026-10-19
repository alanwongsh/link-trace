// Turns platform tags into a dropdown tracking parameter and one placement per link and tag.
// Used by scripts/tags-to-parameters.ts. Plain SQL with no app imports, so Node can run it directly.
//
// Nothing existing is changed or deleted: links keep their tags, /r/<slug>/<tag> keeps working,
// and clicks keep their tag. The only change to existing rows is filling clicks.placement_id
// (new, previously empty) for tag visits, so they count for the matching placement.
import type { Sql, TransactionSql } from "postgres";
import { createSlug } from "./slug.ts";

export type TagMigrationOptions = {
  key: string;
  name: string;
  workspaceId?: string;
  // false runs everything in a transaction and rolls it back, so the report is exact.
  apply: boolean;
};

export type WorkspaceReport = {
  workspaceId: string;
  workspaceName: string;
  parameter: "created" | "existing" | "skipped";
  reason?: string;
  optionsAdded: string[];
  placementsCreated: number;
  clicksLinked: number;
};

const AUDIT_ACTION = "script.tags_to_parameters";
const UNDO_ACTION = "script.tags_to_parameters_undo";
const MAX_PARAMETERS = 30;

class DryRun extends Error {}

async function inTransaction<T>(sql: Sql, apply: boolean, work: (tx: TransactionSql) => Promise<T>): Promise<T> {
  let result: T | undefined;
  try {
    await sql.begin(async (tx) => {
      result = await work(tx);
      if (!apply) throw new DryRun();
    });
  } catch (error) {
    if (!(error instanceof DryRun)) throw error;
  }
  return result as T;
}

async function workspacesWithTags(sql: Sql, workspaceId?: string) {
  return sql<{ id: string; name: string }[]>`
    select w.id, w.name from workspaces w
    where exists (select 1 from links l where l.workspace_id = w.id and cardinality(l.tags) > 0)
      ${workspaceId ? sql`and w.id = ${workspaceId}` : sql``}
    order by w.name`;
}

export async function tagsToParameters(sql: Sql, options: TagMigrationOptions): Promise<WorkspaceReport[]> {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(options.key)) throw new Error(`Invalid key: ${options.key}`);
  const reports: WorkspaceReport[] = [];

  for (const workspace of await workspacesWithTags(sql, options.workspaceId)) {
    const report = await inTransaction(sql, options.apply, async (tx) => {
      const report: WorkspaceReport = {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        parameter: "existing",
        optionsAdded: [],
        placementsCreated: 0,
        clicksLinked: 0,
      };
      // Same lock the app takes when creating parameters in this workspace.
      await tx`select pg_advisory_xact_lock(hashtext(${`parameters:${workspace.id}`}))`;

      let [parameter] = await tx<{ id: string; field_type: string }[]>`
        select id, field_type from tracking_parameters where workspace_id = ${workspace.id} and key = ${options.key}`;
      if (parameter && parameter.field_type !== "dropdown") {
        return { ...report, parameter: "skipped" as const, reason: `${options.key} exists and is not a dropdown` };
      }
      if (!parameter) {
        const [{ total, last }] = await tx<{ total: number; last: number | null }[]>`
          select count(*)::int as total, max(sort_order) as last from tracking_parameters where workspace_id = ${workspace.id}`;
        if (total >= MAX_PARAMETERS) {
          return { ...report, parameter: "skipped" as const, reason: `already has ${MAX_PARAMETERS} parameters` };
        }
        [parameter] = await tx<{ id: string; field_type: string }[]>`
          insert into tracking_parameters (workspace_id, name, key, description, field_type, sort_order)
          values (${workspace.id}, ${options.name}, ${options.key}, 'Made from platform tags', 'dropdown', ${(last ?? -1) + 1})
          returning id, field_type`;
        report.parameter = "created";
      }

      // One option per tag used in this workspace; existing options (any case) are reused.
      await tx`select id from tracking_parameters where id = ${parameter.id} for update`;
      const tags = (
        await tx<{ tag: string }[]>`
          select distinct unnest(tags) as tag from links where workspace_id = ${workspace.id} order by 1`
      ).map((row) => row.tag);
      const existing = await tx<{ id: string; value: string; sort_order: number }[]>`
        select id, value, sort_order from tracking_parameter_options where parameter_id = ${parameter.id}`;
      const optionIds = new Map(existing.map((o) => [o.value.toLowerCase(), o.id]));
      let next = existing.reduce((max, o) => Math.max(max, o.sort_order), -1) + 1;
      const addedIds: string[] = [];
      for (const tag of tags) {
        if (optionIds.has(tag)) continue;
        const [row] = await tx<{ id: string }[]>`
          insert into tracking_parameter_options (parameter_id, value, sort_order)
          values (${parameter.id}, ${tag}, ${next++}) returning id`;
        optionIds.set(tag, row.id);
        addedIds.push(row.id);
        report.optionsAdded.push(tag);
      }

      // One placement per link and tag that does not have one yet.
      const pairs = await tx<{ link_id: string; tag: string }[]>`
        select l.id as link_id, t.tag from links l cross join lateral unnest(l.tags) as t(tag)
        where l.workspace_id = ${workspace.id}
          and not exists (select 1 from placements p where p.link_id = l.id and p.legacy_tag = t.tag)
        order by l.created_at, t.tag`;
      for (const pair of pairs) {
        // A taken code inserts nothing; try another.
        let placementId: string | undefined;
        while (!placementId) {
          const rows = await tx<{ id: string }[]>`
            insert into placements (link_id, code, name, legacy_tag)
            values (${pair.link_id}, ${createSlug(8)}, ${pair.tag}, ${pair.tag})
            on conflict (code) do nothing returning id`;
          placementId = rows[0]?.id;
        }
        await tx`
          insert into placement_values (placement_id, parameter_id, option_id, value)
          values (${placementId}, ${parameter.id}, ${optionIds.get(pair.tag)!}, ${pair.tag})`;
        report.placementsCreated += 1;
      }

      // Past tag visits count for their placement too.
      const linked = await tx`
        update clicks c set placement_id = p.id
        from placements p join links l on l.id = p.link_id
        where l.workspace_id = ${workspace.id} and p.legacy_tag is not null
          and c.link_id = p.link_id and c.tag = p.legacy_tag and c.placement_id is null`;
      report.clicksLinked = linked.count;

      await tx`
        insert into audit_log (action, workspace_id, target_type, target_id, details)
        values (${AUDIT_ACTION}, ${workspace.id}, 'parameter', ${parameter.id}, ${tx.json({
          key: options.key,
          parameterCreated: report.parameter === "created",
          optionIds: addedIds,
          optionsAdded: report.optionsAdded,
          placementsCreated: report.placementsCreated,
          clicksLinked: report.clicksLinked,
        })})`;
      return report;
    });
    reports.push(report);
  }
  return reports;
}

export type UndoReport = {
  workspaceId: string;
  workspaceName: string;
  placementsRemoved: number;
  clicksUnlinked: number;
  optionsRemoved: number;
  parameterRemoved: boolean;
};

// Removes what tagsToParameters() made: placements made from tags (and their click links), and
// the parameter and options it created if nothing else uses them. Tags and clicks are untouched.
export async function undoTagsToParameters(
  sql: Sql,
  options: { workspaceId?: string; apply: boolean },
): Promise<UndoReport[]> {
  const workspaces = await sql<{ id: string; name: string }[]>`
    select distinct w.id, w.name from workspaces w
    join links l on l.workspace_id = w.id join placements p on p.link_id = l.id
    where p.legacy_tag is not null ${options.workspaceId ? sql`and w.id = ${options.workspaceId}` : sql``}
    order by w.name`;
  const reports: UndoReport[] = [];

  for (const workspace of workspaces) {
    const report = await inTransaction(sql, options.apply, async (tx) => {
      const unlinked = await tx`
        update clicks c set placement_id = null
        from placements p join links l on l.id = p.link_id
        where l.workspace_id = ${workspace.id} and p.legacy_tag is not null and c.placement_id = p.id`;
      const removed = await tx`
        delete from placements p using links l
        where l.id = p.link_id and l.workspace_id = ${workspace.id} and p.legacy_tag is not null`;

      let optionsRemoved = 0;
      let parameterRemoved = false;
      const runs = await tx<{ target_id: string; details: { parameterCreated: boolean; optionIds: string[] } }[]>`
        select target_id, details from audit_log
        where action = ${AUDIT_ACTION} and workspace_id = ${workspace.id}`;
      for (const run of runs) {
        if (run.details.parameterCreated) {
          const deleted = await tx`
            delete from tracking_parameters t where t.id = ${run.target_id}
              and not exists (select 1 from placement_values v where v.parameter_id = t.id)`;
          parameterRemoved ||= deleted.count > 0;
        } else if (run.details.optionIds.length) {
          const deleted = await tx`
            delete from tracking_parameter_options o where o.id in ${tx(run.details.optionIds)}
              and not exists (select 1 from placement_values v where v.option_id = o.id)`;
          optionsRemoved += deleted.count;
        }
      }

      const report: UndoReport = {
        workspaceId: workspace.id,
        workspaceName: workspace.name,
        placementsRemoved: removed.count,
        clicksUnlinked: unlinked.count,
        optionsRemoved,
        parameterRemoved,
      };
      await tx`
        insert into audit_log (action, workspace_id, details)
        values (${UNDO_ACTION}, ${workspace.id}, ${tx.json(report)})`;
      return report;
    });
    reports.push(report);
  }
  return reports;
}
