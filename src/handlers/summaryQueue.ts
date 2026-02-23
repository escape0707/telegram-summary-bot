import { processSummaryQueueBatch } from "../app/queue/processSummaryQueueBatch.js";
import type { Env } from "../env.js";
import type { SummaryQueueMessage } from "../queue/summaryJobs.js";

const RETRY_DELAY_SECONDS_CONFIG = 60;

export async function handleSummaryQueue(
  batch: MessageBatch<SummaryQueueMessage>,
  env: Env,
): Promise<void> {
  const botToken = env.TELEGRAM_BOT_TOKEN.trim();
  if (!botToken) {
    console.error("Failed to initialize summary queue consumer", {
      error: "TELEGRAM_BOT_TOKEN is not configured",
    });
    batch.retryAll({ delaySeconds: RETRY_DELAY_SECONDS_CONFIG });
    return;
  }

  await processSummaryQueueBatch(batch, env, botToken);
}
