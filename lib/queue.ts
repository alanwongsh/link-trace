import "server-only";

import type { JobName, JobPayloads } from "@/lib/jobs/catalog";
import type { QueueDriver, SendOptions } from "@/lib/jobs/driver";
import { PgBossDriver } from "@/lib/jobs/pgboss-driver";

// The app's way to start background work: enqueue("bulk-placements", { bulkJobId }). The jobs
// are listed in lib/jobs/catalog.ts and run by scripts/worker.ts.
//
// QUEUE_DRIVER picks the queue: "pgboss" (default) keeps jobs in this Postgres. Another driver,
// such as BullMQ on Redis, only needs a class implementing QueueDriver and a case below.
const globalForQueue = globalThis as unknown as { linkTraceQueue?: Promise<QueueDriver> };

function createDriver(): QueueDriver {
  const kind = process.env.QUEUE_DRIVER || "pgboss";
  const url = process.env.DATABASE_URL;
  switch (kind) {
    case "pgboss":
      if (!url) throw new Error("DATABASE_URL is not set.");
      return new PgBossDriver(url, "sender");
    default:
      throw new Error(`Unknown QUEUE_DRIVER: ${kind}`);
  }
}

function queue(): Promise<QueueDriver> {
  if (!globalForQueue.linkTraceQueue) {
    const driver = createDriver();
    globalForQueue.linkTraceQueue = driver
      .start()
      .then(() => driver)
      .catch((error) => {
        globalForQueue.linkTraceQueue = undefined;
        throw error;
      });
  }
  return globalForQueue.linkTraceQueue;
}

export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N], options?: SendOptions): Promise<void> {
  await (await queue()).send(name, data, options);
}
