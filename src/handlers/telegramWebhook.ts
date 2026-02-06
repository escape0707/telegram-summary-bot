import { sendTelegramMessage } from "../telegram/api";
import {
  buildSummaryErrorText,
  hasBotCommandAtStart,
  parseTelegramCommand
} from "../telegram/commands";
import {
  GROUP_CHAT_TYPES,
  type TelegramMessage,
  type TelegramUpdate
} from "../telegram/types";
import type { Env } from "../env";
import { TELEGRAM_SECRET_HEADER } from "../config";
import {
  insertMessage,
  loadMessagesForSummary,
  type StoredMessage
} from "../db/messages";
import { generateSummary } from "../ai/summary";

export async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
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
    try {
      await ingestMessage(env, message);
    } catch (error) {
      console.error("Failed to insert message", error);
      return new Response("internal error", { status: 500 });
    }
  }

  if (message && hasBotCommandAtStart(message)) {
    const response = await maybeHandleCommand(env, message);
    if (response) {
      return response;
    }
  }

  return new Response("ok", { status: 200 });
}

async function ingestMessage(env: Env, message: TelegramMessage): Promise<void> {
  const text = message.text ?? message.caption ?? null;
  const replyToMessageId = message.reply_to_message?.message_id ?? null;
  const userId = message.from?.id ?? null;
  const username = message.from?.username ?? null;
  const chatUsername = message.chat.username ?? null;

  await insertMessage(env, {
    chatId: message.chat.id,
    chatUsername,
    messageId: message.message_id,
    userId,
    username,
    text,
    ts: message.date,
    replyToMessageId
  });
}

async function maybeHandleCommand(
  env: Env,
  message: TelegramMessage & { text: string }
): Promise<Response | undefined> {
  const commandResult = parseTelegramCommand(message.text);
  let replyText: string | undefined;
  let replyParseMode: "MarkdownV2" | undefined;

  if (commandResult.ok) {
    if (commandResult.command.type === "summary") {
      const windowStart =
        message.date - commandResult.command.fromHours * 60 * 60;
      const windowEnd =
        message.date - commandResult.command.toHours * 60 * 60;

      let rows: StoredMessage[];
      try {
        rows = await loadMessagesForSummary(
          env,
          message.chat.id,
          windowStart,
          windowEnd
        );
      } catch (error) {
        console.error("Failed to load messages for summary", error);
        replyText = "Failed to load messages for summary.";
        rows = [];
      }

      if (!replyText) {
        if (rows.length === 0) {
          replyText = "No messages found in that window.";
        } else {
          const summaryResult = await generateSummary(
            env,
            rows.slice().reverse(),
            commandResult.command,
            message.chat.username
          );
          if (summaryResult.ok) {
            replyText = summaryResult.summary;
            replyParseMode = "MarkdownV2";
          } else if (summaryResult.reason === "no_text") {
            replyText = "No text messages found in that window.";
          } else {
            replyText = "Failed to generate summary (check logs).";
          }
        }
      }
    }
  } else {
    if (commandResult.reason !== "unknown command") {
      replyText = buildSummaryErrorText(commandResult.reason);
    }
    console.warn("Invalid command format", commandResult.reason);
  }

  if (!replyText) {
    return undefined;
  }

  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    return new Response("internal error", { status: 500 });
  }

  const sent = await sendTelegramMessage(
    botToken,
    message.chat.id,
    replyText,
    message.message_id,
    replyParseMode
      ? { parseMode: replyParseMode, disableWebPagePreview: true }
      : undefined
  );
  if (!sent) {
    return new Response("internal error", { status: 502 });
  }

  return new Response("ok", { status: 200 });
}
