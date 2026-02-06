import { handleTelegramWebhook } from "./handlers/telegramWebhook";
import {
  HEALTH_PATH,
  TELEGRAM_PATH,
} from "./config";
import type { Env } from "./env";

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
  }
} satisfies ExportedHandler<Env>;
