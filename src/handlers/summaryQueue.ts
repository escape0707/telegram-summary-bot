import { processSummaryQueueBatch } from "../app/queue/processSummaryQueueBatch.js";
import type { Env } from "../env.js";
import type { SummaryQueueMessage } from "../queue/summaryJobs.js";

export async function handleSummaryQueue(
  batch: MessageBatch<SummaryQueueMessage>,
  env: Env,
): Promise<void> {
  await processSummaryQueueBatch(batch, env);
}
