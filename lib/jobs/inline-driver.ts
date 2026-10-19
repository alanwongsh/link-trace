// Runs each job as soon as it is sent, in the same process: no queue, no worker. The default, so
// the app works on serverless hosting (Vercel). Callers send from after(), so the visitor or
// uploader never waits; one attempt only, and a failure is the caller's to log.
import type { Sql } from "postgres";
import type { JobName, JobPayloads } from "./catalog.ts";
import type { JobHandler, QueueDriver } from "./driver.ts";
import { jobHandlers } from "./handlers.ts";

export class InlineDriver implements QueueDriver {
  readonly #handlers: { [N in JobName]: JobHandler<N> };
  #sent = 0;

  constructor(sql: Sql) {
    this.#handlers = jobHandlers(sql, () => {});
  }

  async start(): Promise<void> {}

  async stop(): Promise<void> {}

  async send<N extends JobName>(name: N, data: JobPayloads[N]): Promise<void> {
    this.#sent += 1;
    const handler = this.#handlers[name] as JobHandler<N>;
    await handler([{ id: `inline-${this.#sent}`, data, attempt: 1 }]);
  }

  async work(): Promise<void> {
    throw new Error("The inline queue runs jobs in the app; it has no worker.");
  }

  // Inline has no clock; jobs that need one (bulk-cleanup) are also sent by the app.
  async schedule(): Promise<void> {}
}
