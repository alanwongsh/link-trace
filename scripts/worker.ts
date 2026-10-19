// Runs every background job in lib/jobs/catalog.ts (bulk placement uploads, hourly removal of
// expired QR zips, clicks) when QUEUE_DRIVER=pgboss. With the default inline queue the app runs
// jobs itself and no worker is needed. With a worker queue, keep one running next to the app:
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
import { createDriver, describeQueue, queueKind } from "../lib/jobs/create-driver.ts";

nextEnv.loadEnvConfig(process.cwd());

const url = process.env.DATABASE_MIGRATION_URL || process.env.DATABASE_URL;
if (!url) {
  console.error("Needs DATABASE_URL in .env.local or the environment.");
  process.exit(1);
}

if (queueKind() === "inline") {
  console.log("QUEUE_DRIVER is inline (the default): jobs run inside the app, so there is nothing for a worker to do.");
  console.log("Set QUEUE_DRIVER=pgboss for both the app and the worker to use the worker.");
  process.exit(0);
}

const sql = postgres(url, { prepare: false, max: 4, onnotice: () => {} });
// The same choice of queue as the app (QUEUE_DRIVER), so both always talk to the same one.
const driver = createDriver("worker");
await driver.start();

const handlers = jobHandlers(sql);
for (const name of JOB_NAMES) {
  // Each entry is the handler for the job of the same name.
  await driver.work(name, handlers[name] as never);
  const cron = JOBS[name].schedule;
  if (cron) await driver.schedule(name, cron);
}

console.log(`Worker running ${JOB_NAMES.join(", ")} (${describeQueue()}). Press Ctrl+C to stop.`);

async function shutdown(signal: string) {
  console.log(`${signal}: finishing current jobs, then stopping.`);
  await driver.stop();
  await sql.end();
  process.exit(0);
}
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
