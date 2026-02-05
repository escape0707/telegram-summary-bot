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
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: {
    message_id: number;
  };
};

type TelegramMessageEntity = {
  type: "mention" | "hashtag" | "cashtag" | "bot_command" | "url" | "email" | "phone_number" | "bold" | "italic" | "underline" | "strikethrough" | "spoiler" | "blockquote" | "expandable_blockquote" | "code" | "pre" | "text_link" | "text_mention" | "custom_emoji";
  offset: number;
  length: number;
};

type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

const GROUP_CHAT_TYPES: TelegramChatType[] = ["group", "supergroup"];

type ParsedCommand =
  | { type: "summary"; fromHours: number; toHours: number }
  | { type: "status" };

type CommandParseResult =
  | { ok: true; command: ParsedCommand }
  | {
      ok: false;
      reason: "unknown command" | "invalid arguments" | "exceeds max hours";
    };

const MAX_SUMMARY_HOURS = 24 * 7;

function parseSummaryHours(token: string): number | undefined {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  const numericPart = trimmed.endsWith("h") ? trimmed.slice(0, -1) : trimmed;
  if (!/^\d+$/.test(numericPart)) {
    return undefined;
  }

  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTelegramCommand(text: string): CommandParseResult {
  const trimmed = text.trim();
  const [rawCommand, ...tokens] = trimmed.split(/\s+/);
  const commandToken = rawCommand.replace(/^\//, "");
  if (!commandToken) {
    return { ok: false, reason: "unknown command" };
  }

  const command = commandToken.split("@", 1)[0].toLowerCase();
  switch (command) {
    case "summary":
      const rawFromHours =
        tokens.length >= 1 ? parseSummaryHours(tokens[0]) : 1;
      const rawToHours =
        tokens.length >= 2 ? parseSummaryHours(tokens[1]) : 0;

      if (rawFromHours === undefined || rawToHours === undefined) {
        return { ok: false, reason: "invalid arguments" };
      }

      const normalizedFromHours = Math.max(1, rawFromHours);
      const normalizedToHours = Math.max(0, rawToHours);

      if (
        normalizedFromHours > MAX_SUMMARY_HOURS ||
        normalizedToHours > MAX_SUMMARY_HOURS
      ) {
        return { ok: false, reason: "exceeds max hours" };
      }
      if (normalizedFromHours <= normalizedToHours) {
        return { ok: false, reason: "invalid arguments" };
      }

      return {
        ok: true,
        command: {
          type: "summary",
          fromHours: normalizedFromHours,
          toHours: normalizedToHours
        }
      };
    case "summaryday":
      return {
        ok: true,
        command: { type: "summary", fromHours: 24, toHours: 0 }
      };
    case "status":
      return { ok: true, command: { type: "status" } };
    default:
      return { ok: false, reason: "unknown command" };
  }
}

function hasBotCommandAtStart(
  message: TelegramMessage
): message is TelegramMessage & {
  text: string;
  entities: TelegramMessageEntity[];
} {
  if (!message.text || !message.entities || message.entities.length === 0) {
    return false;
  }

  return message.entities.some(
    (entity) => entity.type === "bot_command" && entity.offset === 0
  );
}

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

      if (message && hasBotCommandAtStart(message)) {
        const commandResult = parseTelegramCommand(message.text);
        if (!commandResult.ok) {
          console.warn("Invalid command format", commandResult.reason);
        }
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
