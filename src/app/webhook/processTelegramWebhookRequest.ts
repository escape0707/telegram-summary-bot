import { TELEGRAM_SECRET_HEADER } from "../../config.js";
import { insertMessage } from "../../db/messages.js";
import { enforceSummaryRateLimit } from "../../db/rateLimits.js";
import { loadServiceStatusSnapshot } from "../../db/serviceStats.js";
import {
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_TYPE_ON_DEMAND,
} from "../../db/summaryRuns.js";
import type { Env } from "../../env.js";
import {
  resolveCommandAccess,
  type CommandAccessContext,
} from "./commandAccess.js";
import type { TelegramRuntime } from "../runtime/telegramRuntime.js";
import {
  runTrackedSummarizeWindow,
  type WindowSummaryResult,
} from "../summary/summarizeWindow.js";
import { isChatAllowed } from "../../telegram/allowlist.js";
import {
  buildCommandParseErrorText,
  hasBotCommandAtStart,
  parseTelegramCommand,
  type SummaryCommand,
} from "../../telegram/commands.js";
import { sendReplyToMessage } from "../../telegram/send.js";
import {
  buildBlockedChatReplyText,
  buildHelpCommandReplyText,
  buildSummaryDegradedText,
  buildStartCommandReplyText,
  buildStatusText,
  buildSummaryRateLimitText,
} from "../../telegram/texts.js";
import {
  GROUP_CHAT_TYPES,
  type TelegramMessage,
  type TelegramUpdate,
} from "../../telegram/types.js";

export async function processTelegramWebhookRequest(
  request: Request,
  env: Env,
  runtime: TelegramRuntime,
  webhookSecret: string,
  waitUntil?: ExecutionContext["waitUntil"],
): Promise<Response> {
  const providedSecret = request.headers.get(TELEGRAM_SECRET_HEADER);
  if (providedSecret !== webhookSecret) {
    return new Response("unauthorized", { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = await request.json<TelegramUpdate>();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  if (typeof update.update_id !== "number") {
    return new Response("bad request", { status: 400 });
  }

  const message = update.message ?? update.edited_message;
  if (!message) {
    return new Response("ok", { status: 200 });
  }

  const allowedChat = isChatAllowed(message.chat.id, runtime.allowedChatIds);
  const isPrivateChat = message.chat.type === "private";

  if (hasBotCommandAtStart(message)) {
    const response = await tryHandleCommand(
      env,
      runtime,
      message,
      {
        allowedChat,
        isPrivateChat,
      },
      waitUntil,
    );
    if (response) {
      return response;
    }
  } else if (GROUP_CHAT_TYPES.includes(message.chat.type) && allowedChat) {
    try {
      await ingestMessage(env, message);
    } catch (error) {
      console.error("Failed to insert message", error);
      return new Response("internal error", { status: 500 });
    }
  }

  return new Response("ok", { status: 200 });
}

async function sendBlockedChatReply(
  runtime: TelegramRuntime,
  message: TelegramMessage & { text: string },
): Promise<Response> {
  const sent = await sendReplyToMessage(
    runtime.botToken,
    message,
    buildBlockedChatReplyText(message.chat.id, runtime.projectRepoUrl),
  );
  if (!sent) {
    console.error("Failed to send blocked chat reply", {
      chatId: message.chat.id,
      fromUserId: message.from?.id ?? null,
    });
    // Intentionally returns 200 to prevent webhook retries.
    return new Response("ok", { status: 200 });
  }

  console.warn("Blocked command from non-allowlisted chat", {
    chatId: message.chat.id,
    chatType: message.chat.type,
    fromUserId: message.from?.id ?? null,
  });

  return new Response("ok", { status: 200 });
}

async function ingestMessage(
  env: Env,
  message: TelegramMessage,
): Promise<void> {
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
    replyToMessageId,
  });
}

async function tryHandleCommand(
  env: Env,
  runtime: TelegramRuntime,
  message: TelegramMessage & { text: string },
  access: CommandAccessContext,
  waitUntil?: ExecutionContext["waitUntil"],
): Promise<Response | undefined> {
  const commandResult = parseTelegramCommand(message.text);
  if (!commandResult.ok) {
    if (commandResult.reason === "unknown command") {
      // Returns silently for mistyped commands or other bots' commands.
      return undefined;
    }
    if (!access.allowedChat) {
      return await sendBlockedChatReply(runtime, message);
    }
    console.warn("Invalid command format", commandResult.reason);
    const replyText = buildCommandParseErrorText(commandResult.reason);
    return await sendCommandReply(runtime.botToken, message, replyText);
  }

  const command = commandResult.command;
  const accessDecision = resolveCommandAccess(command, access);
  if (!accessDecision.allowed) {
    if (accessDecision.reason === "not_allowlisted") {
      return await sendBlockedChatReply(runtime, message);
    }
    // /help and /start are DM-only; ignore them in all group chats.
    return undefined;
  }

  switch (command.type) {
    case "summary": {
      const replyText = await resolveSummaryCommandReplyText(
        env,
        message,
        command,
        waitUntil,
      );
      return await sendCommandReply(runtime.botToken, message, replyText);
    }
    case "status": {
      try {
        const status = await loadServiceStatusSnapshot(env);
        const replyText = buildStatusText(status, message.date);
        return await sendCommandReply(runtime.botToken, message, replyText);
      } catch (error) {
        console.error("Failed to load service status", error);
        return await sendCommandReply(
          runtime.botToken,
          message,
          "Failed to load status.",
        );
      }
    }
    case "help": {
      const replyText = buildHelpCommandReplyText(runtime.projectRepoUrl);
      return await sendCommandReply(runtime.botToken, message, replyText);
    }
    case "start": {
      const replyText = buildStartCommandReplyText(runtime.projectRepoUrl);
      return await sendCommandReply(runtime.botToken, message, replyText);
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
  command: SummaryCommand,
  waitUntil?: ExecutionContext["waitUntil"],
): Promise<string> {
  try {
    const rateLimit = await enforceSummaryRateLimit(
      env,
      message.chat.id,
      message.from?.id ?? null,
      message.date,
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
    summaryResult = await runTrackedSummarizeWindow(env, {
      chatId: message.chat.id,
      chatUsername: message.chat.username,
      windowStart,
      windowEnd,
      command,
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
        ...(waitUntil ? { waitUntil } : {}),
      },
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
    case "degraded":
      return buildSummaryDegradedText();
    default: {
      const exhaustiveCheck: never = summaryResult.reason;
      return exhaustiveCheck;
    }
  }
}

async function sendCommandReply(
  botToken: string,
  message: TelegramMessage & { text: string },
  replyText: string,
): Promise<Response> {
  const sent = await sendReplyToMessage(botToken, message, replyText);
  if (!sent) {
    return new Response("internal error", { status: 502 });
  }
  return new Response("ok", { status: 200 });
}
