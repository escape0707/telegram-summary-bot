import { beforeEach, describe, expect, it, vi } from "vitest";
import { processSummaryQueueBatch } from "../app/queue/processSummaryQueueBatch.js";
import type { Env } from "../env.js";
import type { SummaryQueueMessage } from "../queue/summaryJobs.js";
import { handleSummaryQueue } from "./summaryQueue.js";

vi.mock("../app/queue/processSummaryQueueBatch.js", () => ({
  processSummaryQueueBatch: vi.fn(),
}));

type BatchControl = {
  batch: MessageBatch<SummaryQueueMessage>;
  retryAll: ReturnType<typeof vi.fn>;
};

function makeEnv(overrides: Partial<Env> = {}): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    PROJECT_REPO_URL: "https://example.com/repo",
    ...overrides,
  };
}

function makeBatch(): BatchControl {
  const retryAll = vi.fn();
  return {
    batch: {
      queue: "summary-jobs",
      messages: [],
      retryAll,
      ackAll: vi.fn(),
    },
    retryAll,
  };
}

describe("handleSummaryQueue", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(processSummaryQueueBatch).mockResolvedValue();
  });

  it("reads bot token and delegates to queue batch processor", async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: "  bot-token  " });
    const { batch, retryAll } = makeBatch();

    await handleSummaryQueue(batch, env);

    expect(processSummaryQueueBatch).toHaveBeenCalledWith(
      batch,
      env,
      "bot-token",
    );
    expect(retryAll).not.toHaveBeenCalled();
  });

  it("retries entire batch when bot token is missing", async () => {
    const env = makeEnv({ TELEGRAM_BOT_TOKEN: "  " });
    const { batch, retryAll } = makeBatch();

    await handleSummaryQueue(batch, env);

    expect(processSummaryQueueBatch).not.toHaveBeenCalled();
    expect(retryAll).toHaveBeenCalledWith({ delaySeconds: 60 });
  });
});
