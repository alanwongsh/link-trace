// The one place that picks the queue, for both the app (lib/queue.ts) and the worker
// (scripts/worker.ts). QUEUE_DRIVER chooses it; "pgboss" is the default.
//
// To add BullMQ: write a BullMqDriver implementing QueueDriver (driver.ts), add "bullmq" below
// (reading REDIS_URL), then let the pg-boss queue empty before switching QUEUE_DRIVER.
import type { QueueDriver } from "./driver.ts";
import { PgBossDriver } from "./pgboss-driver.ts";

export const QUEUE_DRIVERS = ["pgboss"] as const;

// "sender" only adds jobs (the app); "worker" also runs them, plus maintenance and schedules.
export function createDriver(
  role: "sender" | "worker",
  env: Record<string, string | undefined> = process.env,
): QueueDriver {
  const kind = env.QUEUE_DRIVER || "pgboss";
  switch (kind) {
    case "pgboss": {
      // The worker may use a direct or session-pooler address; the app uses its usual one.
      const url = role === "worker" ? env.DATABASE_MIGRATION_URL || env.DATABASE_URL : env.DATABASE_URL;
      if (!url) throw new Error("The pgboss queue needs DATABASE_URL.");
      return new PgBossDriver(url, role);
    }
    default:
      throw new Error(`Unknown QUEUE_DRIVER "${kind}". Supported: ${QUEUE_DRIVERS.join(", ")}.`);
  }
}

// Where the queue lives, for log lines; never includes credentials.
export function describeQueue(env: Record<string, string | undefined> = process.env): string {
  const kind = env.QUEUE_DRIVER || "pgboss";
  const url = env.DATABASE_MIGRATION_URL || env.DATABASE_URL;
  let host = "?";
  try {
    host = url ? new URL(url).host : "?";
  } catch {}
  return `${kind} on ${host}`;
}
