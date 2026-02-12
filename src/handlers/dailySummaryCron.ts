import { generateSummary } from "../ai/summary";
import {
  loadActiveChatsForWindow,
  loadMessagesForSummary
} from "../db/messages";
import type { Env } from "../env";
import type { SummaryCommand } from "../telegram/commands";
import { sendTelegramMessage } from "../telegram/api";

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
  const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
  if (!botToken) {
    console.error("TELEGRAM_BOT_TOKEN is not configured");
    return;
  }

  const windowEnd = Math.floor(controller.scheduledTime / 1_000);
  const windowStart = windowEnd - DAY_SECONDS;

  let chats;
  try {
    chats = await loadActiveChatsForWindow(env, windowStart, windowEnd);
  } catch (error) {
    console.error("Failed to load active chats for daily summary", error);
    return;
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
        console.error("Failed to send daily summary", {
          chatId: chat.chatId
        });
      }
    } catch (error) {
      failedCount += 1;
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
    failedCount
  });
}

function buildDailySummaryMessage(summary: string): string {
  return `${DAILY_SUMMARY_TITLE}\n\n${summary}`;
}
