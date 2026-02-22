import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadActiveChatsForWindow } from "../../db/messages.js";
import { cleanupStaleRateLimits } from "../../db/rateLimits.js";
import type { Env } from "../../env.js";
import { AppError, ErrorCode } from "../../errors/appError.js";
import type { SummaryQueueMessage } from "../../queue/summaryJobs.js";
import { enqueueSummaryJobs } from "../../queue/summaryQueueProducer.js";
import type { TelegramRuntime } from "../runtime/telegramRuntime.js";
import { runDailySummary } from "./runDailySummary.js";

vi.mock("../../db/messages.js", () => ({
  loadActiveChatsForWindow: vi.fn(),
}));

vi.mock("../../db/rateLimits.js", () => ({
  cleanupStaleRateLimits: vi.fn(),
}));

vi.mock("../../queue/summaryQueueProducer.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../queue/summaryQueueProducer.js")>();

  return {
    ...actual,
    enqueueSummaryJobs: vi.fn(),
  };
});

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

function makeRuntime(allowedChatIds: ReadonlySet<number>): TelegramRuntime {
  return {
    botToken: "bot-token",
    allowedChatIds,
    projectRepoUrl: "https://example.com/repo",
  };
}

function makeController(scheduledTimeMs: number): ScheduledController {
  const noRetry = vi.fn<(options?: { delaySeconds?: number }) => void>();
  return {
    cron: "0 8 * * *",
    scheduledTime: scheduledTimeMs,
    noRetry,
  } as ScheduledController;
}

describe("runDailySummary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(cleanupStaleRateLimits).mockResolvedValue(0);
    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([]);
    vi.mocked(enqueueSummaryJobs).mockResolvedValue();
  });

  it("enqueues daily summary jobs for allowlisted active chats", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;
    const windowStart = nowSeconds - 24 * 60 * 60;

    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
    ]);

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const controller = makeController(scheduledTimeMs);

    await expect(runDailySummary(controller, env, runtime)).resolves.toBeUndefined();

    expect(cleanupStaleRateLimits).toHaveBeenCalledWith(env, nowSeconds);
    expect(loadActiveChatsForWindow).toHaveBeenCalledWith(
      env,
      windowStart,
      nowSeconds,
    );
    expect(enqueueSummaryJobs).toHaveBeenCalledWith(env.SUMMARY_QUEUE, [
      {
        type: "daily",
        jobId: `daily:-1001:${windowStart}:${nowSeconds}`,
        chatId: -1001,
        chatUsername: "group_a",
        windowStart,
        windowEnd: nowSeconds,
        scheduledAtTs: nowSeconds,
      },
    ]);
  });

  it("skips non-allowlisted chats when enqueuing daily summary jobs", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;
    const windowStart = nowSeconds - 24 * 60 * 60;

    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
      { chatId: -2002, chatUsername: "group_b" },
    ]);

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const controller = makeController(scheduledTimeMs);

    await expect(runDailySummary(controller, env, runtime)).resolves.toBeUndefined();

    expect(loadActiveChatsForWindow).toHaveBeenCalledWith(
      env,
      windowStart,
      nowSeconds,
    );
    expect(enqueueSummaryJobs).toHaveBeenCalledTimes(1);
    expect(enqueueSummaryJobs).toHaveBeenCalledWith(env.SUMMARY_QUEUE, [
      {
        type: "daily",
        jobId: `daily:-1001:${windowStart}:${nowSeconds}`,
        chatId: -1001,
        chatUsername: "group_a",
        windowStart,
        windowEnd: nowSeconds,
        scheduledAtTs: nowSeconds,
      },
    ]);
  });

  it("throws partial failure when job enqueue fails", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;

    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
      { chatId: -1002, chatUsername: "group_b" },
    ]);
    vi.mocked(enqueueSummaryJobs).mockRejectedValue(new Error("queue down"));

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001, -1002]));
    const controller = makeController(scheduledTimeMs);

    let thrownError: unknown;
    try {
      await runDailySummary(controller, env, runtime);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    if (thrownError instanceof AppError) {
      expect(thrownError.code).toBe(ErrorCode.CronDispatchPartialFailure);
      expect(thrownError.message).toContain("failed to enqueue daily summary jobs");
    }

    expect(enqueueSummaryJobs).toHaveBeenCalledTimes(1);
  });

  it("continues dispatch when cleanup fails", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;
    const windowStart = nowSeconds - 24 * 60 * 60;

    vi.mocked(cleanupStaleRateLimits).mockRejectedValue(new Error("cleanup failed"));
    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
    ]);

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const controller = makeController(scheduledTimeMs);

    await expect(runDailySummary(controller, env, runtime)).resolves.toBeUndefined();

    expect(loadActiveChatsForWindow).toHaveBeenCalledWith(
      env,
      windowStart,
      nowSeconds,
    );
    expect(enqueueSummaryJobs).toHaveBeenCalledTimes(1);
  });

  it("throws config missing when SUMMARY_QUEUE binding is absent", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;

    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
    ]);

    const env = makeEnv();
    delete env.SUMMARY_QUEUE;
    const runtime = makeRuntime(new Set<number>([-1001]));
    const controller = makeController(scheduledTimeMs);

    let thrownError: unknown;
    try {
      await runDailySummary(controller, env, runtime);
    } catch (error) {
      thrownError = error;
    }

    expect(thrownError).toBeInstanceOf(AppError);
    if (thrownError instanceof AppError) {
      expect(thrownError.code).toBe(ErrorCode.ConfigMissing);
      expect(thrownError.message).toContain("SUMMARY_QUEUE");
    }
    expect(enqueueSummaryJobs).not.toHaveBeenCalled();
  });
});
