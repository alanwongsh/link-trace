// What each job does, for the worker. The only place job names map to code.
import type { Sql } from "postgres";
import { removeExpiredZips, runBulkJob } from "../bulk-job.ts";
import { rebuildTotals, rollUpClicks } from "../click-rollup.ts";
import type { JobName } from "./catalog.ts";
import { insertClicks } from "./click-job.ts";
import type { JobHandler } from "./driver.ts";

type Log = (message: string) => void;

export function jobHandlers(sql: Sql, log: Log = console.log): { [N in JobName]: JobHandler<N> } {
  return {
    "bulk-placements": async (jobs) => {
      for (const job of jobs) {
        const started = Date.now();
        const id = job.data.bulkJobId;
        log(`bulk-placements ${id}: starting (attempt ${job.attempt})`);
        const result = await runBulkJob(sql, id, (done, total) => log(`bulk-placements ${id}: ${done}/${total} QR codes`));
        log(`bulk-placements ${id}: ${result} in ${((Date.now() - started) / 1000).toFixed(1)}s`);
      }
    },
    "bulk-cleanup": async () => {
      const removed = await removeExpiredZips(sql);
      if (removed) log(`bulk-cleanup: removed ${removed} expired zip${removed === 1 ? "" : "s"}`);
    },
    "record-click": async (jobs) => {
      await insertClicks(
        sql,
        jobs.map((job) => job.data),
      );
    },
    "click-rollup": async () => {
      const days = await rollUpClicks(sql);
      if (days) log(`click-rollup: totalled ${days} day${days === 1 ? "" : "s"}`);
    },
    "rebuild-totals": async (jobs) => {
      for (const job of jobs) {
        await rebuildTotals(sql, job.data);
        log(`rebuild-totals: ${"workspaceId" in job.data ? `workspace ${job.data.workspaceId}` : `${job.data.linkIds.length} links`}`);
      }
    },
  };
}
