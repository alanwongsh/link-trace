// The one place that picks the queue, for both the app (lib/queue.ts) and the worker
// (scripts/worker.ts). QUEUE_DRIVER chooses it:
//
//   inline (default)  jobs run right away in the app, after the response; no worker. Works on Vercel.
//   pgboss            jobs wait in Postgres (schema "pgboss") for `npm run worker`.
//   bullmq            later: Redis. Write a BullMqDriver implementing QueueDriver (driver.ts), add it
//                     below (reading REDIS_URL), let the current queue empty, then switch.
import type { Sql } from "postgres";
import type { QueueDriver } from "./driver.ts";
import { InlineDriver } from "./inline-driver.ts";
import { PgBossDriver } from "./pgboss-driver.ts";

export const QUEUE_DRIVERS = ["inline", "pgboss"] as const;
export type QueueKind = (typeof QUEUE_DRIVERS)[number];

export function queueKind(env: Record<string, string | undefined> = process.env): QueueKind {
  const kind = env.QUEUE_DRIVER || "inline";
  if (!(QUEUE_DRIVERS as readonly string[]).includes(kind)) {
    throw new Error(`Unknown QUEUE_DRIVER "${kind}". Supported: ${QUEUE_DRIVERS.join(", ")}.`);
  }
  return kind as QueueKind;
}

// "sender" only adds jobs (the app); "worker" also runs them, plus maintenance and schedules.
// sql is the app's database client, which the inline queue runs jobs with.
export function createDriver(
  role: "sender" | "worker",
  env: Record<string, string | undefined> = process.env,
  sql?: () => Sql,
): QueueDriver {
  switch (queueKind(env)) {
    case "inline":
      if (role === "worker") throw new Error("QUEUE_DRIVER=inline runs jobs in the app, so no worker is needed.");
      if (!sql) throw new Error("The inline queue needs the app's database client.");
      return new InlineDriver(sql());
    case "pgboss": {
      // The worker may use a direct or session-pooler address; the app uses its usual one.
      const url = role === "worker" ? env.DATABASE_MIGRATION_URL || env.DATABASE_URL : env.DATABASE_URL;
      if (!url) throw new Error("The pgboss queue needs DATABASE_URL.");
      return new PgBossDriver(url, role);
    }
  }
}

// Where the queue lives, for log lines; never includes credentials.
export function describeQueue(env: Record<string, string | undefined> = process.env): string {
  const kind = env.QUEUE_DRIVER || "inline";
  const url = env.DATABASE_MIGRATION_URL || env.DATABASE_URL;
  let host = "?";
  try {
    host = url ? new URL(url).host : "?";
  } catch {}
  return `${kind} on ${host}`;
}
