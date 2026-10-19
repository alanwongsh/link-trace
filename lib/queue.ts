import "server-only";

import { getSqlClient } from "@/lib/db";
import type { JobName, JobPayloads } from "@/lib/jobs/catalog";
import { createDriver, queueKind } from "@/lib/jobs/create-driver";
import type { QueueDriver, SendOptions } from "@/lib/jobs/driver";

// The app's way to start background work: enqueue("bulk-placements", { bulkJobId }). The jobs
// are listed in lib/jobs/catalog.ts. QUEUE_DRIVER decides where they run (lib/jobs/create-driver.ts):
// inline (default) runs them right here, so call enqueue from after() to keep requests fast.
const globalForQueue = globalThis as unknown as { linkTraceQueue?: Promise<QueueDriver> };

function queue(): Promise<QueueDriver> {
  if (!globalForQueue.linkTraceQueue) {
    globalForQueue.linkTraceQueue = (async () => {
      const driver = createDriver("sender", process.env, getSqlClient);
      await driver.start();
      return driver;
    })().catch((error) => {
      globalForQueue.linkTraceQueue = undefined;
      throw error;
    });
  }
  return globalForQueue.linkTraceQueue;
}

export async function enqueue<N extends JobName>(name: N, data: JobPayloads[N], options?: SendOptions): Promise<void> {
  await (await queue()).send(name, data, options);
}

// True when jobs run in the app (no worker): the UI words waiting jobs differently.
export function jobsRunInline(): boolean {
  return queueKind() === "inline";
}
