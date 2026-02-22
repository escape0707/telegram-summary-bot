import { beforeEach, describe, expect, it, vi } from "vitest";
import { runTrackedSummarizeWindow } from "../summary/summarizeWindow.js";
import { sendMessageToChat } from "../../telegram/send.js";
import type { Env } from "../../env.js";
import type { SummaryQueueMessage } from "../../queue/summaryJobs.js";
import { processSummaryQueueBatch } from "./processSummaryQueueBatch.js";

vi.mock("../summary/summarizeWindow.js", () => ({
  runTrackedSummarizeWindow: vi.fn(),
}));

vi.mock("../../telegram/send.js", () => ({
  sendMessageToChat: vi.fn(),
}));

type BatchControl = {
  batch: MessageBatch<SummaryQueueMessage>;
  ackFns: Array<ReturnType<typeof vi.fn>>;
  retryFns: Array<ReturnType<typeof vi.fn>>;
  retryAll: ReturnType<typeof vi.fn>;
};

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
    SUMMARY_QUEUE: {} as Queue<SummaryQueueMessage>,
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: "bot-token",
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
  const ackFns: Array<ReturnType<typeof vi.fn>> = [];
  const retryFns: Array<ReturnType<typeof vi.fn>> = [];

  const queueMessages = messages.map((body, index) => {
    const ack = vi.fn();
    const retry = vi.fn();
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
    vi.mocked(sendMessageToChat).mockResolvedValue(true);
  });

  it("summarizes daily jobs, sends message, and acks", async () => {
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env);

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
      "bot-token",
      -1001,
      "<b>Daily Summary (Auto, last 24h)</b>\n\n<b>summary</b>",
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

    await processSummaryQueueBatch(batch, env);

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

    await processSummaryQueueBatch(batch, env);

    expect(ackFns[0]).not.toHaveBeenCalled();
    expect(retryFns[0]).toHaveBeenCalledWith({ delaySeconds: 30 });
  });

  it("retries whole batch when bot token is missing", async () => {
    const env = makeEnv();
    env.TELEGRAM_BOT_TOKEN = "  ";
    const { batch, ackFns, retryFns, retryAll } = makeBatch([makeDailyJob()]);

    await processSummaryQueueBatch(batch, env);

    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 60 });
    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(ackFns[0]).not.toHaveBeenCalled();
    expect(retryFns[0]).not.toHaveBeenCalled();
  });

  it("acks on-demand jobs before on-demand rollout", async () => {
    const env = makeEnv();
    const { batch, ackFns, retryFns } = makeBatch([makeOnDemandJob()]);

    await processSummaryQueueBatch(batch, env);

    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(sendMessageToChat).not.toHaveBeenCalled();
    expect(ackFns[0]).toHaveBeenCalledTimes(1);
    expect(retryFns[0]).not.toHaveBeenCalled();
  });
});
