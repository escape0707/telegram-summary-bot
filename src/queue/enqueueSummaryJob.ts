import type { SummaryQueueMessage } from "./summaryJobs.js";

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
