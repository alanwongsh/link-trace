// Runs every background job in lib/jobs/catalog.ts: bulk placement uploads, hourly removal of
// expired QR zips, and queued clicks (when CLICK_INGEST=queue). Keep one running next to the app:
//
//   npm run worker
//
// Several can run at once; each job is handled by one of them. Needs DATABASE_URL (or
// DATABASE_MIGRATION_URL) in .env.local or the environment. Through Supabase, use the session
// pooler (port 5432) rather than the transaction pooler.
import nextEnv from "@next/env";
import postgres from "postgres";
import { JOB_NAMES, JOBS } from "../lib/jobs/catalog.ts";
import { jobHandlers } from "../lib/jobs/handlers.ts";
import { PgBossDriver } from "../lib/jobs/pgboss-driver.ts";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Needs DATABASE_URL in .env.local or the environment.");
  process.exit(1);
}
if ((process.env.QUEUE_DRIVER || "pgboss") !== "pgboss") {
  console.error(`QUEUE_DRIVER=${process.env.QUEUE_DRIVER} has no worker yet.`);
  process.exit(1);
}

const sql = postgres(url, { prepare: false, max: 4, onnotice: () => {} });
const driver = new PgBossDriver(url, "worker");
await driver.start();

const handlers = jobHandlers(sql);
for (const name of JOB_NAMES) {
  // Each entry is the handler for the job of the same name.
  await driver.work(name, handlers[name] as never);
  const cron = JOBS[name].schedule;
  if (cron) await driver.schedule(name, cron);
}

console.log(`Worker running ${JOB_NAMES.join(", ")} on ${new URL(url).host}. Press Ctrl+C to stop.`);

async function shutdown(signal: string) {
  console.log(`${signal}: finishing current jobs, then stopping.`);
  await driver.stop();
  await sql.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
