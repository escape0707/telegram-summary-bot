import { sendTelegramMessage } from "../telegram/api.js";
import {
  buildCommandParseErrorText,
  hasBotCommandAtStart,
  parseTelegramCommand,
  type SummaryCommand
} from "../telegram/commands.js";
import {
  GROUP_CHAT_TYPES,
  type TelegramMessage,
  type TelegramUpdate
} from "../telegram/types.js";
import type { Env } from "../env.js";
import { TELEGRAM_SECRET_HEADER } from "../config.js";
import {
  insertMessage,
  loadMessagesForSummary,
  type StoredMessage
} from "../db/messages.js";
import { loadServiceStatusSnapshot } from "../db/serviceStats.js";
import { runTrackedResponse } from "../ops/serviceTracking.js";
import { generateSummary } from "../ai/summary.js";

export async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  return runTrackedResponse(env, "webhook", async () => {
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

    if (message && hasBotCommandAtStart(message)) {
      const response = await tryHandleCommand(env, message);
      if (response) {
        return response;
      }
    } else if (message && GROUP_CHAT_TYPES.includes(message.chat.type)) {
      try {
        await ingestMessage(env, message);
      } catch (error) {
        console.error("Failed to insert message", error);
        return new Response("internal error", { status: 500 });
      }
    }

    return new Response("ok", { status: 200 });
  });
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
      const replyText = await buildSummaryCommandReplyText(env, message, command);
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

async function buildSummaryCommandReplyText(
  env: Env,
  message: TelegramMessage & { text: string },
  command: SummaryCommand
): Promise<string> {
  const windowStart = message.date - command.fromHours * 60 * 60;
  const windowEnd = message.date - command.toHours * 60 * 60;

  let rows: StoredMessage[];
  try {
    rows = await loadMessagesForSummary(env, message.chat.id, windowStart, windowEnd);
  } catch (error) {
    console.error("Failed to load messages for summary", error);
    return "Failed to load messages for summary.";
  }

  if (rows.length === 0) {
    return "No messages found in that window.";
  }

  const summaryResult = await generateSummary(
    env,
    rows.slice().reverse(),
    command,
    message.chat.id,
    message.chat.username
  );
  if (summaryResult.ok) {
    return summaryResult.summary;
  }
  if (summaryResult.reason === "no_text") {
    return "No text messages found in that window.";
  }
  return "Failed to generate summary (check logs).";
}

async function sendCommandReply(
  env: Env,
  message: TelegramMessage & { text: string },
  replyText: string
): Promise<Response> {
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    return new Response("internal error", { status: 500 });
  }
  const sent = await sendTelegramMessage(
    botToken,
    message.chat.id,
    replyText,
    message.message_id
  );
  if (!sent) {
    return new Response("internal error", { status: 502 });
  }
  return new Response("ok", { status: 200 });
}

function buildStatusText(
  status: {
    uptimeStart: number;
    lastOkTs: number | null;
    errorCount: number;
    lastError: string | null;
    messageCount: number;
    summaryCount: number;
  },
  nowSeconds: number
): string {
  const uptimeSeconds = Math.max(0, nowSeconds - status.uptimeStart);

  const days = Math.floor(uptimeSeconds / 86_400);
  const hours = Math.floor((uptimeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((uptimeSeconds % 3_600) / 60);

  const uptimeText = `${days}d ${hours}h ${minutes}m`;
  const lastOkText = formatTimestamp(status.lastOkTs);
  const lastErrorText = status.lastError
    ? escapeHtml(status.lastError)
    : "none";

  return [
    "<b>Status</b>",
    `Uptime: ${uptimeText}`,
    `Errors: ${status.errorCount}`,
    `Last OK: ${lastOkText}`,
    `Last error: ${lastErrorText}`,
    `Stored messages: ${status.messageCount}`,
    `Stored summaries: ${status.summaryCount}`
  ].join("\n");
}

function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null) {
    return "n/a";
  }

  return new Date(timestamp * 1_000).toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
