import type { Env } from "../env.js";
import { AppError, ErrorCode } from "../errors/appError.js";
import type { SummaryQueueMessage } from "./summaryJobs.js";

export function requireSummaryQueue(env: Env): Queue<SummaryQueueMessage> {
  if (!env.SUMMARY_QUEUE) {
    throw new AppError(
      ErrorCode.ConfigMissing,
      "SUMMARY_QUEUE is not configured",
    );
  }

  return env.SUMMARY_QUEUE;
}

export async function enqueueSummaryJob(
  queue: Queue<SummaryQueueMessage>,
  job: SummaryQueueMessage,
): Promise<void> {
  await queue.send(job);
}

export async function enqueueSummaryJobs(
  queue: Queue<SummaryQueueMessage>,
  jobs: SummaryQueueMessage[],
): Promise<void> {
  if (jobs.length === 0) {
    return;
  }

  await queue.sendBatch(jobs.map((job) => ({ body: job })));
}
