import { handleDailySummaryCron } from "./handlers/dailySummaryCron.js";
import { handleTelegramWebhook } from "./handlers/telegramWebhook.js";
import { HEALTH_PATH, TELEGRAM_PATH } from "./config.js";
import type { Env } from "./env.js";

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH) {
      return new Response("ok", { status: 200 });
    }

    if (pathname === TELEGRAM_PATH) {
      return handleTelegramWebhook(request, env);
    }

    return new Response("not found", { status: 404 });
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(handleDailySummaryCron(controller, env));
  },
} satisfies ExportedHandler<Env>;
