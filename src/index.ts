export interface Env {
  DB: D1Database;
  TELEGRAM_WEBHOOK_SECRET: string;
}

const HEALTH_PATH = "/health";
const TELEGRAM_PATH = "/telegram";
const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

type TelegramChatType = "private" | "group" | "supergroup" | "channel";

type TelegramUser = {
  id: number;
  username?: string;
};

type TelegramChat = {
  id: number;
  type: TelegramChatType;
  username?: string;
};

type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: {
    message_id: number;
  };
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

const GROUP_CHAT_TYPES: TelegramChatType[] = ["group", "supergroup"];

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

      const message = update.message ?? update.edited_message;
      if (message && GROUP_CHAT_TYPES.includes(message.chat.type)) {
        const text = message.text ?? message.caption ?? null;
        const replyToMessageId = message.reply_to_message?.message_id ?? null;
        const userId = message.from?.id ?? null;
        const username = message.from?.username ?? null;
        const chatUsername = message.chat.username ?? null;

        try {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO messages (
              chat_id,
              chat_username,
              message_id,
              user_id,
              username,
              text,
              ts,
              reply_to_message_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              message.chat.id,
              chatUsername,
              message.message_id,
              userId,
              username,
              text,
              message.date,
              replyToMessageId
            )
            .run();
        } catch (error) {
          console.error("Failed to insert message", error);
          return new Response("internal error", { status: 500 });
        }
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
