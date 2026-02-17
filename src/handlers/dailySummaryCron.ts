import { generateSummary } from "../ai/summary.js";
import {
  loadActiveChatsForWindow,
  loadMessagesForSummary
} from "../db/messages.js";
import { cleanupStaleRateLimits } from "../db/rateLimits.js";
import type { Env } from "../env.js";
import { AppError, ErrorCode } from "../ops/errors.js";
import { runTrackedTask } from "../ops/serviceTracking.js";
import type { SummaryCommand } from "../telegram/commands.js";
import { sendTelegramMessage } from "../telegram/api.js";

const DAY_SECONDS = 24 * 60 * 60;

const DAILY_SUMMARY_COMMAND: SummaryCommand = {
  type: "summary",
  fromHours: 24,
  toHours: 0
};
const DAILY_SUMMARY_TITLE = "<b>Daily Summary (Auto, last 24h)</b>";

export async function handleDailySummaryCron(
  controller: ScheduledController,
  env: Env
): Promise<void> {
  return runTrackedTask(env, "cron.daily_summary", async () => {
    const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
    if (!botToken) {
      console.error("TELEGRAM_BOT_TOKEN is not configured");
      throw new AppError(
        ErrorCode.ConfigMissing,
        "TELEGRAM_BOT_TOKEN is not configured"
      );
    }

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
      activeChats: chats.length
    });

    let sentCount = 0;
    let skippedNoMessages = 0;
    let skippedNoText = 0;
    let failedCount = 0;
    let firstFailureReason: string | undefined;

    for (const chat of chats) {
      try {
        const rows = await loadMessagesForSummary(
          env,
          chat.chatId,
          windowStart,
          windowEnd
        );
        if (rows.length === 0) {
          skippedNoMessages += 1;
          continue;
        }

        const summaryResult = await generateSummary(
          env,
          rows.slice().reverse(),
          DAILY_SUMMARY_COMMAND,
          chat.chatId,
          chat.chatUsername ?? undefined
        );

        if (!summaryResult.ok) {
          if (summaryResult.reason === "no_text") {
            skippedNoText += 1;
          } else {
            failedCount += 1;
            firstFailureReason ??= `summary generation failed for chat ${chat.chatId}`;
            console.error("Failed to generate daily summary", {
              chatId: chat.chatId,
              reason: summaryResult.reason
            });
          }
          continue;
        }

        const sent = await sendTelegramMessage(
          botToken,
          chat.chatId,
          buildDailySummaryMessage(summaryResult.summary)
        );
        if (sent) {
          sentCount += 1;
        } else {
          failedCount += 1;
          firstFailureReason ??= `telegram send failed for chat ${chat.chatId}`;
          console.error("Failed to send daily summary", {
            chatId: chat.chatId
          });
        }
      } catch (error) {
        failedCount += 1;
        firstFailureReason ??= `dispatch exception for chat ${chat.chatId}`;
        console.error("Daily summary dispatch failed", {
          chatId: chat.chatId,
          error
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
      failedCount,
      cleanupDeleted
    });

    if (failedCount > 0) {
      throw new AppError(
        ErrorCode.CronDispatchPartialFailure,
        `completed with ${failedCount} failures (${firstFailureReason ?? "unknown"})`
      );
    }
  });
}

function buildDailySummaryMessage(summary: string): string {
  return `${DAILY_SUMMARY_TITLE}\n\n${summary}`;
}
