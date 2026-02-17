import { TELEGRAM_SECRET_HEADER } from "../../config.js";
import { insertMessage } from "../../db/messages.js";
import { enforceSummaryRateLimit } from "../../db/rateLimits.js";
import { loadServiceStatusSnapshot } from "../../db/serviceStats.js";
import type { Env } from "../../env.js";
import {
  summarizeWindow,
  type WindowSummaryResult
} from "../summary/summarizeWindow.js";
import {
  buildCommandParseErrorText,
  hasBotCommandAtStart,
  parseTelegramCommand,
  type SummaryCommand
} from "../../telegram/commands.js";
import { getBotToken, sendReplyToMessage } from "../../telegram/send.js";
import {
  buildStatusText,
  buildSummaryRateLimitText
} from "../../telegram/texts.js";
import {
  GROUP_CHAT_TYPES,
  type TelegramMessage,
  type TelegramUpdate
} from "../../telegram/types.js";

export async function processTelegramWebhookRequest(
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
  if (!message) {
    return new Response("ok", { status: 200 });
  }

  if (hasBotCommandAtStart(message)) {
    const response = await tryHandleCommand(env, message);
    if (response) {
      return response;
    }
  } else if (GROUP_CHAT_TYPES.includes(message.chat.type)) {
    try {
      await ingestMessage(env, message);
    } catch (error) {
      console.error("Failed to insert message", error);
      return new Response("internal error", { status: 500 });
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

async function tryHandleCommand(
  env: Env,
  message: TelegramMessage & { text: string }
): Promise<Response | undefined> {
  const commandResult = parseTelegramCommand(message.text);
  if (!commandResult.ok) {
    if (commandResult.reason === "unknown command") {
      // Returns silently for mistyped commands or other bots' commands.
      return undefined;
    }
    console.warn("Invalid command format", commandResult.reason);
    const replyText = buildCommandParseErrorText(commandResult.reason);
    return sendCommandReply(env, message, replyText);
  }

  const command = commandResult.command;
  switch (command.type) {
    case "summary": {
      const replyText = await resolveSummaryCommandReplyText(env, message, command);
      return sendCommandReply(env, message, replyText);
    }
    case "status": {
      try {
        const status = await loadServiceStatusSnapshot(env);
        const replyText = buildStatusText(status, message.date);
        return sendCommandReply(env, message, replyText);
      } catch (error) {
        console.error("Failed to load service status", error);
        return sendCommandReply(env, message, "Failed to load status.");
      }
    }
    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}

async function resolveSummaryCommandReplyText(
  env: Env,
  message: TelegramMessage & { text: string },
  command: SummaryCommand
): Promise<string> {
  try {
    const rateLimit = await enforceSummaryRateLimit(
      env,
      message.chat.id,
      message.from?.id ?? null,
      message.date
    );
    if (!rateLimit.allowed) {
      return buildSummaryRateLimitText(rateLimit);
    }
  } catch (error) {
    // Fail-open to avoid blocking usage when rate-limit storage is unhealthy.
    console.error("Failed to check summary rate limit", error);
  }

  const windowStart = message.date - command.fromHours * 60 * 60;
  const windowEnd = message.date - command.toHours * 60 * 60;

  let summaryResult: WindowSummaryResult;
  try {
    summaryResult = await summarizeWindow(env, {
      chatId: message.chat.id,
      chatUsername: message.chat.username,
      windowStart,
      windowEnd,
      command
    });
  } catch (error) {
    console.error("Failed to load messages for summary", error);
    return "Failed to load messages for summary.";
  }

  if (summaryResult.ok) {
    return summaryResult.summary;
  }

  switch (summaryResult.reason) {
    case "no_messages":
      return "No messages found in that window.";
    case "no_text":
      return "No text messages found in that window.";
    case "ai_error":
      return "Failed to generate summary (check logs).";
    default: {
      const exhaustiveCheck: never = summaryResult.reason;
      return exhaustiveCheck;
    }
  }
}

async function sendCommandReply(
  env: Env,
  message: TelegramMessage & { text: string },
  replyText: string
): Promise<Response> {
  const botToken = getBotToken(env);
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    return new Response("internal error", { status: 500 });
  }
  const sent = await sendReplyToMessage(botToken, message, replyText);
  if (!sent) {
    return new Response("internal error", { status: 502 });
  }
  return new Response("ok", { status: 200 });
}
