import { loadActiveChatsForWindow } from "../../db/messages.js";
import { cleanupStaleRateLimits } from "../../db/rateLimits.js";
import type { Env } from "../../env.js";
import { AppError, ErrorCode } from "../../errors/appError.js";
import type { TelegramRuntime } from "../runtime/telegramRuntime.js";
import { isChatAllowed } from "../../telegram/allowlist.js";
import { enqueueSummaryJobs } from "../../queue/enqueueSummaryJob.js";
import {
  SUMMARY_JOB_TYPE_DAILY,
  type SummaryQueueMessage,
} from "../../queue/summaryJobs.js";

const DAY_SECONDS = 24 * 60 * 60;

function requireSummaryQueue(env: Env): Queue<SummaryQueueMessage> {
  if (!env.SUMMARY_QUEUE) {
    throw new AppError(ErrorCode.ConfigMissing, "SUMMARY_QUEUE is not configured");
  }

  return env.SUMMARY_QUEUE;
}

export async function runDailySummary(
  controller: ScheduledController,
  env: Env,
  runtime: TelegramRuntime,
): Promise<void> {
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

  const jobs: SummaryQueueMessage[] = [];
  let skippedNotAllowlisted = 0;

  for (const chat of chats) {
    if (!isChatAllowed(chat.chatId, runtime.allowedChatIds)) {
      skippedNotAllowlisted += 1;
      continue;
    }

    jobs.push({
      type: SUMMARY_JOB_TYPE_DAILY,
      jobId: `daily:${chat.chatId}:${windowStart}:${windowEnd}`,
      chatId: chat.chatId,
      ...(chat.chatUsername ? { chatUsername: chat.chatUsername } : {}),
      windowStart,
      windowEnd,
      scheduledAtTs: windowEnd,
    });
  }
  const enqueuedCount = jobs.length;
  const summaryQueue = requireSummaryQueue(env);

  try {
    await enqueueSummaryJobs(summaryQueue, jobs);
  } catch (error) {
    console.error("Failed to enqueue daily summary jobs", {
      windowStart,
      windowEnd,
      jobCount: jobs.length,
      error,
    });
    throw new AppError(
      ErrorCode.CronDispatchPartialFailure,
      `failed to enqueue daily summary jobs (${jobs.length})`,
    );
  }

  console.log("Daily summary cron finished", {
    windowStart,
    windowEnd,
    activeChats: chats.length,
    enqueuedCount,
    skippedNotAllowlisted,
    cleanupDeleted,
  });
}
