import { handleDailySummaryCron } from "./handlers/dailySummaryCron.js";
import { handleSummaryQueue } from "./handlers/summaryQueue.js";
import { handleTelegramWebhook } from "./handlers/telegramWebhook.js";
import { HEALTH_PATH, TELEGRAM_PATH } from "./config.js";
import type { Env } from "./env.js";
import type { SummaryQueueMessage } from "./queue/summaryJobs.js";

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH) {
      return new Response("ok", { status: 200 });
    }

    if (pathname === TELEGRAM_PATH) {
      return await handleTelegramWebhook(request, env, ctx);
    }

    return new Response("not found", { status: 404 });
  },
  scheduled(controller, env, ctx) {
    ctx.waitUntil(handleDailySummaryCron(controller, env, ctx));
  },
  async queue(batch: MessageBatch<SummaryQueueMessage>, env) {
    await handleSummaryQueue(batch, env);
  },
} satisfies ExportedHandler<Env, SummaryQueueMessage>;
