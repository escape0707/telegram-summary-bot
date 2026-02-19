import { loadActiveChatsForWindow } from "../../db/messages.js";
import { cleanupStaleRateLimits } from "../../db/rateLimits.js";
import {
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_TYPE_DAILY_CRON,
} from "../../db/summaryRuns.js";
import type { Env } from "../../env.js";
import { AppError, ErrorCode } from "../../errors/appError.js";
import type { TelegramRuntime } from "../runtime/telegramRuntime.js";
import { runTrackedSummarizeWindow } from "../summary/summarizeWindow.js";
import { isChatAllowed } from "../../telegram/allowlist.js";
import type { SummaryCommand } from "../../telegram/commands.js";
import { sendMessageToChat } from "../../telegram/send.js";
import { buildDailySummaryMessage } from "../../telegram/texts.js";

const DAY_SECONDS = 24 * 60 * 60;

const DAILY_SUMMARY_COMMAND: SummaryCommand = {
  type: "summary",
  fromHours: 24,
  toHours: 0,
};

export async function runDailySummary(
  controller: ScheduledController,
  env: Env,
  runtime: TelegramRuntime,
  waitUntil?: ExecutionContext["waitUntil"],
): Promise<void> {
  const botToken = runtime.botToken;

  const windowEnd = Math.floor(controller.scheduledTime / 1_000);
  const windowStart = windowEnd - DAY_SECONDS;
  let cleanupDeleted = 0;

  try {
    cleanupDeleted = await cleanupStaleRateLimits(env, windowEnd);
    if (cleanupDeleted > 0) {
      console.log("Deleted stale rate limit rows", { cleanupDeleted });
    }
  } catch (error) {
    // Best-effort cleanup. Should not block daily summaries.
    console.error("Failed to cleanup stale rate limits", error);
  }

  let chats;
  try {
    chats = await loadActiveChatsForWindow(env, windowStart, windowEnd);
  } catch (error) {
    console.error("Failed to load active chats for daily summary", error);
    throw new AppError(ErrorCode.DbQueryFailed, "could not load active chats");
  }

  console.log("Daily summary cron started", {
    cron: controller.cron,
    scheduledTime: new Date(controller.scheduledTime).toISOString(),
    activeChats: chats.length,
  });

  let sentCount = 0;
  let skippedNoMessages = 0;
  let skippedNoText = 0;
  let skippedDegraded = 0;
  let skippedNotAllowlisted = 0;
  let failedCount = 0;
  let firstFailureReason: string | undefined;

  for (const chat of chats) {
    if (!isChatAllowed(chat.chatId, runtime.allowedChatIds)) {
      skippedNotAllowlisted += 1;
      continue;
    }

    try {
      const summaryResult = await runTrackedSummarizeWindow(env, {
        chatId: chat.chatId,
        chatUsername: chat.chatUsername ?? undefined,
        windowStart,
        windowEnd,
        command: DAILY_SUMMARY_COMMAND,
        summaryRunContext: {
          source: SUMMARY_RUN_SOURCE_REAL_USAGE,
          runType: SUMMARY_RUN_TYPE_DAILY_CRON,
          ...(waitUntil ? { waitUntil } : {}),
        },
      });

      if (!summaryResult.ok) {
        switch (summaryResult.reason) {
          case "no_messages":
            skippedNoMessages += 1;
            break;
          case "no_text":
            skippedNoText += 1;
            break;
          case "degraded":
            skippedDegraded += 1;
            break;
          case "ai_error":
            failedCount += 1;
            firstFailureReason ??= `summary generation failed for chat ${chat.chatId}`;
            console.error("Failed to generate daily summary", {
              chatId: chat.chatId,
              reason: summaryResult.reason,
            });
            break;
          default: {
            const exhaustiveCheck: never = summaryResult.reason;
            throw new Error(
              `Unhandled summary result reason: ${String(exhaustiveCheck)}`,
            );
          }
        }
        continue;
      }

      const sent = await sendMessageToChat(
        botToken,
        chat.chatId,
        buildDailySummaryMessage(summaryResult.summary),
      );
      if (sent) {
        sentCount += 1;
      } else {
        failedCount += 1;
        firstFailureReason ??= `telegram send failed for chat ${chat.chatId}`;
        console.error("Failed to send daily summary", {
          chatId: chat.chatId,
        });
      }
    } catch (error) {
      failedCount += 1;
      firstFailureReason ??= `dispatch exception for chat ${chat.chatId}`;
      console.error("Daily summary dispatch failed", {
        chatId: chat.chatId,
        error,
      });
    }
  }

  console.log("Daily summary cron finished", {
    windowStart,
    windowEnd,
    activeChats: chats.length,
    sentCount,
    skippedNoMessages,
    skippedNoText,
    skippedDegraded,
    skippedNotAllowlisted,
    failedCount,
    cleanupDeleted,
  });

  if (failedCount > 0) {
    throw new AppError(
      ErrorCode.CronDispatchPartialFailure,
      `completed with ${failedCount} failures (${firstFailureReason ?? "unknown"})`,
    );
  }
}
