import {
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_TYPE_DAILY_CRON,
  SUMMARY_RUN_TYPE_ON_DEMAND,
} from "../../db/summaryRuns.js";
import type { Env } from "../../env.js";
import { AppError, ErrorCode } from "../../errors/appError.js";
import type { SummaryCommand } from "../../telegram/commands.js";
import { sendMessageToChat, sendReplyToChatMessage } from "../../telegram/send.js";
import { buildDailySummaryMessage, buildSummaryDegradedText } from "../../telegram/texts.js";
import {
  SUMMARY_JOB_TYPE_DAILY,
  SUMMARY_JOB_TYPE_ON_DEMAND,
  type DailySummaryJob,
  type OnDemandSummaryJob,
  type SummaryQueueMessage,
} from "../../queue/summaryJobs.js";
import { runTrackedSummarizeWindow } from "../summary/summarizeWindow.js";

const DAILY_SUMMARY_COMMAND: SummaryCommand = {
  type: "summary",
  fromHours: 24,
  toHours: 0,
};

const RETRY_DELAY_SECONDS_DEFAULT = 10;
const RETRY_DELAY_SECONDS_AI_ERROR = 30;
const RETRY_DELAY_SECONDS_CONFIG = 60;

type QueueDisposition =
  | { action: "ack" }
  | { action: "retry"; delaySeconds: number };

function readRequiredBotToken(env: Env): string {
  const token = env.TELEGRAM_BOT_TOKEN.trim();
  if (!token) {
    throw new AppError(
      ErrorCode.ConfigMissing,
      "TELEGRAM_BOT_TOKEN is not configured",
    );
  }

  return token;
}

async function processDailySummaryJob(
  env: Env,
  botToken: string,
  job: DailySummaryJob,
): Promise<QueueDisposition> {
  const summaryResult = await runTrackedSummarizeWindow(env, {
    chatId: job.chatId,
    chatUsername: job.chatUsername,
    windowStart: job.windowStart,
    windowEnd: job.windowEnd,
    command: DAILY_SUMMARY_COMMAND,
    summaryRunContext: {
      source: SUMMARY_RUN_SOURCE_REAL_USAGE,
      runType: SUMMARY_RUN_TYPE_DAILY_CRON,
    },
  });

  if (!summaryResult.ok) {
    switch (summaryResult.reason) {
      case "no_messages":
      case "no_text":
      case "degraded":
        return { action: "ack" };
      case "ai_error":
        return { action: "retry", delaySeconds: RETRY_DELAY_SECONDS_AI_ERROR };
      default: {
        const exhaustiveCheck: never = summaryResult.reason;
        return exhaustiveCheck;
      }
    }
  }

  const sent = await sendMessageToChat(
    botToken,
    job.chatId,
    buildDailySummaryMessage(summaryResult.summary),
  );
  if (!sent) {
    return { action: "retry", delaySeconds: RETRY_DELAY_SECONDS_DEFAULT };
  }

  return { action: "ack" };
}

async function processOnDemandSummaryJob(
  env: Env,
  botToken: string,
  job: OnDemandSummaryJob,
): Promise<QueueDisposition> {
  const windowStart = job.requestedAtTs - job.command.fromHours * 60 * 60;
  const windowEnd = job.requestedAtTs - job.command.toHours * 60 * 60;

  const summaryResult = await runTrackedSummarizeWindow(env, {
    chatId: job.chatId,
    chatUsername: job.chatUsername,
    windowStart,
    windowEnd,
    command: job.command,
    summaryRunContext: {
      source: SUMMARY_RUN_SOURCE_REAL_USAGE,
      runType: SUMMARY_RUN_TYPE_ON_DEMAND,
    },
  });

  let replyText: string;
  if (summaryResult.ok) {
    replyText = summaryResult.summary;
  } else {
    switch (summaryResult.reason) {
      case "no_messages":
        replyText = "No messages found in that window.";
        break;
      case "no_text":
        replyText = "No text messages found in that window.";
        break;
      case "ai_error":
        replyText = "Failed to generate summary (check logs).";
        break;
      case "degraded":
        replyText = buildSummaryDegradedText();
        break;
      default: {
        const exhaustiveCheck: never = summaryResult.reason;
        return exhaustiveCheck;
      }
    }
  }

  const sent = await sendReplyToChatMessage(
    botToken,
    job.chatId,
    job.replyToMessageId,
    replyText,
  );
  if (!sent) {
    return { action: "retry", delaySeconds: RETRY_DELAY_SECONDS_DEFAULT };
  }

  return { action: "ack" };
}

async function processSummaryQueueMessage(
  env: Env,
  botToken: string,
  job: SummaryQueueMessage,
): Promise<QueueDisposition> {
  switch (job.type) {
    case SUMMARY_JOB_TYPE_DAILY:
      return await processDailySummaryJob(env, botToken, job);
    case SUMMARY_JOB_TYPE_ON_DEMAND:
      return await processOnDemandSummaryJob(env, botToken, job);
    default: {
      const exhaustiveCheck: never = job;
      return exhaustiveCheck;
    }
  }
}

export async function processSummaryQueueBatch(
  batch: MessageBatch<SummaryQueueMessage>,
  env: Env,
): Promise<void> {
  if (batch.messages.length === 0) {
    return;
  }

  console.log("Received summary queue batch", {
    queue: batch.queue,
    size: batch.messages.length,
  });

  let botToken: string;
  try {
    botToken = readRequiredBotToken(env);
  } catch (error) {
    console.error("Failed to initialize summary queue consumer", { error });
    batch.retryAll({ delaySeconds: RETRY_DELAY_SECONDS_CONFIG });
    return;
  }

  for (const message of batch.messages) {
    try {
      const disposition = await processSummaryQueueMessage(env, botToken, message.body);
      if (disposition.action === "retry") {
        message.retry({ delaySeconds: disposition.delaySeconds });
      } else {
        message.ack();
      }
    } catch (error) {
      console.error("Failed to process summary queue message", {
        queue: batch.queue,
        messageId: message.id,
        attempts: message.attempts,
        error,
      });
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS_DEFAULT });
    }
  }
}
