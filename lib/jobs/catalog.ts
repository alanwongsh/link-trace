// Every background job: its name, the data it carries, and how the queue treats it. The app adds
// jobs with enqueue() (lib/queue.ts); scripts/worker.ts runs every job listed here. A new job is a
// new entry here plus a handler in lib/jobs/handlers.ts. No imports, so Node can load it directly.

// A visit to record, captured when it happened so queue delay never shifts its time.
export type ClickJob = {
  // Made at the visit, so a retried job cannot save the same click twice.
  id: string;
  linkId: string;
  visitorId: string;
  ip: string | null;
  userAgent: string | null;
  referrer: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  isBot: boolean;
  tag: string | null;
  // Null with a tag: the placement made from that tag, if any, is looked up when saved.
  placementId: string | null;
  clickedAt: string;
};

export type JobPayloads = {
  "bulk-placements": { bulkJobId: string };
  "bulk-cleanup": Record<string, never>;
  "record-click": ClickJob;
};

export type JobName = keyof JobPayloads;

export type JobSettings = {
  // Tries after the first failure, and the wait between them.
  retryLimit: number;
  retryDelaySeconds: number;
  // A job running longer than this is treated as failed and retried.
  expireInSeconds: number;
  // How many jobs one handler call receives; handlers always take a list.
  batchSize: number;
  // Cron schedule (UTC) for jobs the worker starts by itself.
  schedule?: string;
};

export const JOBS: Record<JobName, JobSettings> = {
  // 15 minutes covers 1,000 PNG QR codes comfortably.
  "bulk-placements": { retryLimit: 2, retryDelaySeconds: 60, expireInSeconds: 15 * 60, batchSize: 1 },
  "bulk-cleanup": { retryLimit: 1, retryDelaySeconds: 60, expireInSeconds: 5 * 60, batchSize: 1, schedule: "17 * * * *" },
  // Saved in batches; a failed batch is retried soon, and each click saves at most once.
  "record-click": { retryLimit: 5, retryDelaySeconds: 10, expireInSeconds: 60, batchSize: 200 },
};

export const JOB_NAMES = Object.keys(JOBS) as JobName[];
