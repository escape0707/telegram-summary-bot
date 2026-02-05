export interface Env {
  DB: D1Database;
  TELEGRAM_WEBHOOK_SECRET: string;
}

const HEALTH_PATH = "/health";
const TELEGRAM_PATH = "/telegram";
const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

type TelegramUpdate = {
  update_id: number;
};

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH) {
      return new Response("ok", { status: 200 });
    }

    if (pathname === TELEGRAM_PATH) {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }

      const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
      if (!expectedSecret) {
        return new Response("webhook secret not configured", { status: 500 });
      }

      const providedSecret = request.headers.get(TELEGRAM_SECRET_HEADER);
      if (providedSecret !== expectedSecret) {
        return new Response("unauthorized", { status: 401 });
      }

      let update: TelegramUpdate;
      try {
        update = await request.json<TelegramUpdate>();
      } catch {
        return new Response("bad request", { status: 400 });
      }

      if (!update || typeof update.update_id !== "number") {
        return new Response("bad request", { status: 400 });
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
