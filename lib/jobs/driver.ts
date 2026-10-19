// The queue as the rest of the app sees it. pg-boss implements it today (pgboss-driver.ts); a
// BullMQ driver would implement the same interface, chosen with QUEUE_DRIVER. Type-only imports.
import type { JobName, JobPayloads } from "./catalog.ts";

export type SendOptions = {
  // Only one waiting job per key; a second send with the same key is dropped.
  singletonKey?: string;
  startAfterSeconds?: number;
};

export type QueuedJob<N extends JobName> = { id: string; data: JobPayloads[N]; attempt: number };

export type JobHandler<N extends JobName> = (jobs: QueuedJob<N>[]) => Promise<void>;

export interface QueueDriver {
  start(): Promise<void>;
  stop(): Promise<void>;
  send<N extends JobName>(name: N, data: JobPayloads[N], options?: SendOptions): Promise<void>;
  // Worker side: run handler for jobs of this name, in batches of the job's batchSize.
  work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void>;
  // Worker side: start the job on its cron schedule.
  schedule(name: JobName, cron: string): Promise<void>;
}
