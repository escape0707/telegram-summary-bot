import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  claimSummaryQueueJob,
  markSummaryQueueJobDone,
  releaseSummaryQueueJobClaim,
} from "../../db/summaryQueueJobs.js";
import { runTrackedSummarizeWindow } from "../summary/summarizeWindow.js";
import { sendMessageToChat, sendReplyToChatMessage } from "../../telegram/send.js";
import type { Env } from "../../env.js";
import type { SummaryQueueMessage } from "../../queue/summaryJobs.js";
import { processSummaryQueueBatch } from "./processSummaryQueueBatch.js";

const TEST_BOT_TOKEN = "bot-token";
const CLAIM_LEASE_UNTIL = 1_030;
const CLAIM_UPDATED_AT = 1_000;

vi.mock("../summary/summarizeWindow.js", () => ({
  runTrackedSummarizeWindow: vi.fn(),
}));

vi.mock("../../db/summaryQueueJobs.js", () => ({
  claimSummaryQueueJob: vi.fn(),
  markSummaryQueueJobDone: vi.fn(),
  releaseSummaryQueueJobClaim: vi.fn(),
}));

vi.mock("../../telegram/send.js", () => ({
  sendMessageToChat: vi.fn(),
  sendReplyToChatMessage: vi.fn(),
}));

type BatchControl = {
  batch: MessageBatch<SummaryQueueMessage>;
  ackFns: Array<AckFn>;
  retryFns: Array<RetryFn>;
  retryAll: ReturnType<typeof vi.fn<() => void>>;
};

type RetryOptions = Parameters<Message<SummaryQueueMessage>["retry"]>[0];
type AckFn = ReturnType<typeof vi.fn<() => void>>;
type RetryFn = ReturnType<typeof vi.fn<(options?: RetryOptions) => void>>;

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
    SUMMARY_QUEUE: {} as Queue<SummaryQueueMessage>,
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: TEST_BOT_TOKEN,
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    PROJECT_REPO_URL: "https://example.com/repo",
  };
}

function makeDailyJob(overrides: Partial<SummaryQueueMessage> = {}): SummaryQueueMessage {
  return {
    type: "daily",
    jobId: "daily:-1001:100:200",
    chatId: -1001,
    chatUsername: "group_a",
    windowStart: 100,
    windowEnd: 200,
    scheduledAtTs: 200,
    ...overrides,
  } as SummaryQueueMessage;
}

function makeOnDemandJob(
  overrides: Partial<SummaryQueueMessage> = {},
): SummaryQueueMessage {
  return {
    type: "on_demand",
    jobId: "on_demand:-1001:1",
    chatId: -1001,
    chatUsername: "group_a",
    command: { type: "summary", fromHours: 1, toHours: 0 },
    requestedAtTs: 200,
    requesterUserId: 42,
    replyToMessageId: 10,
    ...overrides,
  } as SummaryQueueMessage;
}

function makeBatch(messages: SummaryQueueMessage[]): BatchControl {
  const ackFns: Array<AckFn> = [];
  const retryFns: Array<RetryFn> = [];

  const queueMessages = messages.map((body, index) => {
    const ack = vi.fn<() => void>();
    const retry = vi.fn<(options?: RetryOptions) => void>();
    ackFns.push(ack);
    retryFns.push(retry);

    return {
      id: `msg-${index + 1}`,
      timestamp: new Date(0),
      body,
      attempts: 1,
      ack,
      retry,
    } as Message<SummaryQueueMessage>;
  });

  const retryAll = vi.fn();
  const ackAll = vi.fn();

  return {
    batch: {
      queue: "summary-jobs",
      messages: queueMessages,
      retryAll,
      ackAll,
    },
    ackFns,
    retryFns,
    retryAll,
  };
}

describe("processSummaryQueueBatch", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: true,
      summary: "<b>summary</b>",
    });
    vi.mocked(claimSummaryQueueJob).mockResolvedValue({
      status: "acquired",
      leaseUntil: CLAIM_LEASE_UNTIL,
      updatedAt: CLAIM_UPDATED_AT,
    });
    vi.mocked(markSummaryQueueJobDone).mockResolvedValue({ status: "marked" });
    vi.mocked(releaseSummaryQueueJobClaim).mockResolvedValue();
    vi.mocked(sendMessageToChat).mockResolvedValue(true);
    vi.mocked(sendReplyToChatMessage).mockResolvedValue(true);
  });

  it("summarizes daily jobs, sends message, and acks", async () => {
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(runTrackedSummarizeWindow).toHaveBeenCalledWith(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 100,
      windowEnd: 200,
      command: { type: "summary", fromHours: 24, toHours: 0 },
      summaryRunContext: {
        source: "real_usage",
        runType: "daily_cron",
      },
    });
    expect(sendMessageToChat).toHaveBeenCalledWith(
      TEST_BOT_TOKEN,
      -1001,
      "<b>Daily Summary (Auto, last 24h)</b>\n\n<b>summary</b>",
    );
    expect(markSummaryQueueJobDone).toHaveBeenCalledWith(
      env,
      "daily:-1001:100:200",
      CLAIM_LEASE_UNTIL,
      CLAIM_UPDATED_AT,
      expect.any(Number),
    );
    expect(ackFns[0]).toHaveBeenCalledTimes(1);
    expect(retryFns[0]).not.toHaveBeenCalled();
  });

  it("acks daily jobs with no_messages result", async () => {
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: false,
      reason: "no_messages",
    });
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(sendMessageToChat).not.toHaveBeenCalled();
    expect(ackFns[0]).toHaveBeenCalledTimes(1);
    expect(retryFns[0]).not.toHaveBeenCalled();
  });

  it("retries daily jobs on ai_error", async () => {
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: false,
      reason: "ai_error",
    });
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(ackFns[0]).not.toHaveBeenCalled();
    expect(retryFns[0]).toHaveBeenCalledWith({ delaySeconds: 30 });
    expect(releaseSummaryQueueJobClaim).toHaveBeenCalledWith(
      env,
      "daily:-1001:100:200",
      CLAIM_LEASE_UNTIL,
      CLAIM_UPDATED_AT,
    );
  });

  it("acks duplicate jobs that are already done", async () => {
    vi.mocked(claimSummaryQueueJob).mockResolvedValue({ status: "already_done" });
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(sendMessageToChat).not.toHaveBeenCalled();
    expect(ackFns[0]).toHaveBeenCalledTimes(1);
    expect(retryFns[0]).not.toHaveBeenCalled();
  });

  it("retries jobs that are currently in_flight", async () => {
    const leaseUntil = Math.floor(Date.now() / 1_000) + 60;
    vi.mocked(claimSummaryQueueJob).mockResolvedValue({
      status: "in_flight",
      leaseUntil,
    });
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(ackFns[0]).not.toHaveBeenCalled();
    const retryFn = retryFns[0];
    if (!retryFn) {
      throw new Error("retry function missing");
    }
    const retryOptions = retryFn.mock.calls[0]?.[0];
    expect(retryOptions?.delaySeconds).toBeGreaterThanOrEqual(55);
    expect(retryOptions?.delaySeconds).toBeLessThanOrEqual(60);
  });

  it("retries when idempotency claim lookup fails", async () => {
    vi.mocked(claimSummaryQueueJob).mockRejectedValue(new Error("db down"));
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(ackFns[0]).not.toHaveBeenCalled();
    expect(retryFns[0]).toHaveBeenCalledWith({ delaySeconds: 10 });
  });

  it("summarizes on-demand jobs, replies to command message, and acks", async () => {
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeOnDemandJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(runTrackedSummarizeWindow).toHaveBeenCalledWith(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: -3400,
      windowEnd: 200,
      command: { type: "summary", fromHours: 1, toHours: 0 },
      summaryRunContext: {
        source: "real_usage",
        runType: "on_demand",
      },
    });
    expect(sendReplyToChatMessage).toHaveBeenCalledWith(
      TEST_BOT_TOKEN,
      -1001,
      10,
      "<b>summary</b>",
    );
    expect(sendMessageToChat).not.toHaveBeenCalled();
    expect(ackFns[0]).toHaveBeenCalledTimes(1);
    expect(retryFns[0]).not.toHaveBeenCalled();
  });

  it("retries when recording done state fails after processing", async () => {
    vi.mocked(markSummaryQueueJobDone).mockRejectedValue(new Error("db down"));
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(ackFns[0]).not.toHaveBeenCalled();
    expect(retryFns[0]).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(releaseSummaryQueueJobClaim).toHaveBeenCalledWith(
      env,
      "daily:-1001:100:200",
      CLAIM_LEASE_UNTIL,
      CLAIM_UPDATED_AT,
    );
  });

  it("acks when completion write reports lost_claim", async () => {
    vi.mocked(markSummaryQueueJobDone).mockResolvedValue({ status: "lost_claim" });
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(ackFns[0]).toHaveBeenCalledTimes(1);
    expect(retryFns[0]).not.toHaveBeenCalled();
  });

  it("replies with no messages text for on-demand jobs", async () => {
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: false,
      reason: "no_messages",
    });
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeOnDemandJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(sendReplyToChatMessage).toHaveBeenCalledWith(
      TEST_BOT_TOKEN,
      -1001,
      10,
      "No messages found in that window.",
    );
    expect(ackFns[0]).toHaveBeenCalledTimes(1);
    expect(retryFns[0]).not.toHaveBeenCalled();
  });

  it("retries on-demand jobs when Telegram reply fails", async () => {
    vi.mocked(sendReplyToChatMessage).mockResolvedValue(false);
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeOnDemandJob()]);

    await processSummaryQueueBatch(batch, env, TEST_BOT_TOKEN);

    expect(ackFns[0]).not.toHaveBeenCalled();
    expect(retryFns[0]).toHaveBeenCalledWith({ delaySeconds: 10 });
    expect(releaseSummaryQueueJobClaim).toHaveBeenCalledWith(
      env,
      "on_demand:-1001:1",
      CLAIM_LEASE_UNTIL,
      CLAIM_UPDATED_AT,
    );
  });
});
