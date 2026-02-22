import { processSummaryQueueBatch } from "../app/queue/processSummaryQueueBatch.js";
import type { Env } from "../env.js";
import type { SummaryQueueMessage } from "../queue/summaryJobs.js";

export function handleSummaryQueue(
  batch: MessageBatch<SummaryQueueMessage>,
  env: Env,
  ctx: ExecutionContext,
): void {
  void env;
  void ctx;
  processSummaryQueueBatch(batch);
}
