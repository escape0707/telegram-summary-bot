import type { SummaryQueueMessage } from "../../queue/summaryJobs.js";

export function processSummaryQueueBatch(
  batch: MessageBatch<SummaryQueueMessage>,
): void {
  if (batch.messages.length === 0) {
    return;
  }

  console.log("Received summary queue batch", {
    queue: batch.queue,
    size: batch.messages.length,
  });
  batch.ackAll();
}
