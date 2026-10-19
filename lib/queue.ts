import "server-only";

import type { JobName, JobPayloads } from "@/lib/jobs/catalog";
import { createDriver } from "@/lib/jobs/create-driver";
import type { QueueDriver, SendOptions } from "@/lib/jobs/driver";

// The app's way to start background work: enqueue("bulk-placements", { bulkJobId }). The jobs
// are listed in lib/jobs/catalog.ts and run by scripts/worker.ts. The queue itself is chosen in
// lib/jobs/create-driver.ts (QUEUE_DRIVER).
const globalForQueue = globalThis as unknown as { linkTraceQueue?: Promise<QueueDriver> };

function queue(): Promise<QueueDriver> {
  if (!globalForQueue.linkTraceQueue) {
    globalForQueue.linkTraceQueue = (async () => {
      const driver = createDriver("sender");
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
