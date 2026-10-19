// Turns each workspace's platform tags into a dropdown tracking parameter, with one placement
// per link and tag. Links keep their tags and /r/<slug>/<tag> keeps working; tag visits, past
// and future, also count for the matching placement.
//
//   npm run tags:migrate                          preview every workspace (changes nothing)
//   npm run tags:migrate -- --apply               make the changes
//   npm run tags:migrate -- --workspace <id>      only one workspace
//   npm run tags:migrate -- --key channel --name Channel   parameter key and name (default platform / Platform)
//   npm run tags:migrate -- --undo [--apply]      remove what this script made
//
// Safe to run again: anything already made is skipped. Needs DATABASE_URL (or
// DATABASE_MIGRATION_URL) in .env.local or the environment.
import nextEnv from "@next/env";
import postgres from "postgres";
import { tagsToParameters, undoTagsToParameters } from "../lib/tag-migration.ts";

nextEnv.loadEnvConfig(process.cwd());

const args = process.argv.slice(2);
function option(name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index === -1 ? undefined : args[index + 1];
}

const apply = args.includes("--apply");
const undo = args.includes("--undo");
const workspaceId = option("workspace");
const key = option("key") ?? "platform";
const name = option("name") ?? "Platform";
const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;

if (!url) {
  console.error("Needs DATABASE_URL in .env.local or the environment.");
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 1, onnotice: () => {} });
try {
  const host = new URL(url).host.replace(/^[^@]*@/, "");
  console.log(`${apply ? "Applying" : "Preview only (add --apply to make changes)"} on ${host}\n`);

  if (undo) {
    const reports = await undoTagsToParameters(sql, { workspaceId, apply });
    if (reports.length === 0) console.log("Nothing to undo.");
    else console.table(reports.map(({ workspaceId: _, ...r }) => r));
  } else {
    const reports = await tagsToParameters(sql, { key, name, workspaceId, apply });
    if (reports.length === 0) console.log("No workspace has links with tags.");
    else console.table(
      reports.map((r) => ({
        workspace: r.workspaceName,
        parameter: r.reason ? `skipped: ${r.reason}` : `${key} (${r.parameter})`,
        "options added": r.optionsAdded.join(", ") || "—",
        "placements made": r.placementsCreated,
        "past visits linked": r.clicksLinked,
      })),
    );
  }
  if (!apply) console.log("\nNothing was changed. Run again with --apply to make these changes.");
} finally {
  await sql.end();
}
