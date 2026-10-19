// The queue on pg-boss, which keeps jobs in this same Postgres (schema "pgboss"). No Redis needed.
import { PgBoss } from "pg-boss";
import { JOB_NAMES, JOBS, type JobName, type JobPayloads } from "./catalog.ts";
import type { JobHandler, QueueDriver, SendOptions } from "./driver.ts";

export class PgBossDriver implements QueueDriver {
  readonly #boss: PgBoss;
  readonly #polling: number | undefined;

  // "sender" only adds jobs (the app); "worker" also runs maintenance and schedules.
  constructor(connectionString: string, role: "sender" | "worker", options: { pollingIntervalSeconds?: number } = {}) {
    this.#boss = new PgBoss(
      role === "sender"
        ? { connectionString, max: 2, supervise: false, schedule: false }
        : { connectionString, max: 4 },
    );
    this.#polling = options.pollingIntervalSeconds;
    this.#boss.on("error", (error) => console.error("Queue error:", error instanceof Error ? error.message : error));
  }

  async start(): Promise<void> {
    await this.#boss.start();
    for (const name of JOB_NAMES) {
      if (await this.#boss.getQueue(name)) continue;
      const settings = JOBS[name];
      try {
        await this.#boss.createQueue(name, {
          retryLimit: settings.retryLimit,
          retryDelay: settings.retryDelaySeconds,
          expireInSeconds: settings.expireInSeconds,
        });
      } catch (error) {
        // Another process may have created it at the same moment.
        if (!(await this.#boss.getQueue(name))) throw error;
      }
    }
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true, timeout: 30_000 });
  }

  async send<N extends JobName>(name: N, data: JobPayloads[N], options: SendOptions = {}): Promise<void> {
    await this.#boss.send(name, data, {
      ...(options.singletonKey ? { singletonKey: options.singletonKey } : {}),
      ...(options.startAfterSeconds ? { startAfter: options.startAfterSeconds } : {}),
    });
  }

  async work<N extends JobName>(name: N, handler: JobHandler<N>): Promise<void> {
    await this.#boss.work<JobPayloads[N]>(
      name,
      { batchSize: JOBS[name].batchSize, ...(this.#polling ? { pollingIntervalSeconds: this.#polling } : {}) },
      async (jobs) => handler(jobs.map((job) => ({ id: job.id, data: job.data, attempt: job.retryCount + 1 }))),
    );
  }

  async schedule(name: JobName, cron: string): Promise<void> {
    await this.#boss.schedule(name, cron);
  }
}
