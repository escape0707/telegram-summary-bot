import {
  claimSummaryQueueJob,
  markSummaryQueueJobDone,
  releaseSummaryQueueJobClaim,
  type SummaryQueueJobClaimResult,
} from "../../db/summaryQueueJobs.js";
import {
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_TYPE_DAILY_CRON,
  SUMMARY_RUN_TYPE_ON_DEMAND,
} from "../../db/summaryRuns.js";
import type { Env } from "../../env.js";
import type { SummaryCommand } from "../../telegram/commands.js";
import {
  sendMessageToChat,
  sendReplyToChatMessage,
} from "../../telegram/send.js";
import {
  buildDailySummaryMessage,
  buildSummaryDegradedText,
} from "../../telegram/texts.js";
import {
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
const RETRY_DELAY_SECONDS_IN_FLIGHT = 5;
const JOB_CLAIM_LEASE_SECONDS = 300;
const RETRY_DELAY_SECONDS_IN_FLIGHT_MAX = JOB_CLAIM_LEASE_SECONDS;

type QueueDisposition =
  | { action: "ack" }
  | { action: "retry"; delaySeconds: number };

function nowSeconds(): number {
  return Math.floor(Date.now() / 1_000);
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

function computeInFlightRetryDelay(leaseUntil: number): number {
  const waitSeconds = leaseUntil - nowSeconds();
  return Math.max(
    RETRY_DELAY_SECONDS_IN_FLIGHT,
    Math.min(RETRY_DELAY_SECONDS_IN_FLIGHT_MAX, waitSeconds),
  );
}

async function safeReleaseJobClaimWithOwnership(
  env: Env,
  jobId: string,
  claim: Extract<SummaryQueueJobClaimResult, { status: "acquired" }>,
): Promise<void> {
  try {
    await releaseSummaryQueueJobClaim(
      env,
      jobId,
      claim.leaseUntil,
      claim.updatedAt,
    );
  } catch (error) {
    console.error("Failed to release summary queue job claim", {
      jobId,
      error,
    });
  }
}

async function safeMarkSummaryQueueJobDone(
  batch: MessageBatch<SummaryQueueMessage>,
  env: Env,
  message: Message<SummaryQueueMessage>,
  claim: Extract<SummaryQueueJobClaimResult, { status: "acquired" }>,
): Promise<"marked" | "already_done" | "lost_claim" | "error"> {
  const { jobId } = message.body;
  try {
    const doneResult = await markSummaryQueueJobDone(
      env,
      jobId,
      claim.leaseUntil,
      claim.updatedAt,
      nowSeconds(),
    );
    return doneResult.status;
  } catch (error) {
    console.error("Failed to mark summary queue job done", {
      queue: batch.queue,
      messageId: message.id,
      jobId,
      error,
    });
    return "error";
  }
}

export async function processSummaryQueueBatch(
  batch: MessageBatch<SummaryQueueMessage>,
  env: Env,
  botToken: string,
): Promise<void> {
  if (batch.messages.length === 0) {
    return;
  }

  console.log("Received summary queue batch", {
    queue: batch.queue,
    size: batch.messages.length,
  });

  for (const message of batch.messages) {
    let claim: SummaryQueueJobClaimResult;
    try {
      claim = await claimSummaryQueueJob(
        env,
        message.body.jobId,
        nowSeconds(),
        JOB_CLAIM_LEASE_SECONDS,
      );
    } catch (error) {
      console.error("Failed to claim summary queue job", {
        queue: batch.queue,
        messageId: message.id,
        jobId: message.body.jobId,
        error,
      });
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS_DEFAULT });
      continue;
    }

    if (claim.status === "already_done") {
      message.ack();
      continue;
    }

    if (claim.status === "in_flight") {
      message.retry({
        delaySeconds: computeInFlightRetryDelay(claim.leaseUntil),
      });
      continue;
    }

    const acquiredClaim = claim;
    const { jobId } = message.body;
    try {
      const job = message.body;
      let disposition: QueueDisposition;
      switch (job.type) {
        case "daily":
          disposition = await processDailySummaryJob(env, botToken, job);
          break;
        case "on_demand":
          disposition = await processOnDemandSummaryJob(env, botToken, job);
          break;
        default: {
          const exhaustiveCheck: never = job;
          disposition = exhaustiveCheck;
        }
      }

      if (disposition.action === "retry") {
        await safeReleaseJobClaimWithOwnership(env, jobId, acquiredClaim);
        message.retry({ delaySeconds: disposition.delaySeconds });
        continue;
      }

      const doneResult = await safeMarkSummaryQueueJobDone(
        batch,
        env,
        message,
        acquiredClaim,
      );
      if (doneResult === "error") {
        await safeReleaseJobClaimWithOwnership(env, jobId, acquiredClaim);
        message.retry({ delaySeconds: RETRY_DELAY_SECONDS_DEFAULT });
        continue;
      }

      if (doneResult === "lost_claim") {
        console.warn("Summary queue job claim lost before completion", {
          queue: batch.queue,
          messageId: message.id,
          jobId,
        });
      }

      message.ack();
    } catch (error) {
      console.error("Failed to process summary queue message", {
        queue: batch.queue,
        messageId: message.id,
        jobId,
        attempts: message.attempts,
        error,
      });
      await safeReleaseJobClaimWithOwnership(env, jobId, acquiredClaim);
      message.retry({ delaySeconds: RETRY_DELAY_SECONDS_DEFAULT });
    }
  }
}
