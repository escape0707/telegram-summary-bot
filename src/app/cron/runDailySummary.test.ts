import { describe, expect, it, vi, beforeEach } from "vitest";
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
import { sendMessageToChat } from "../../telegram/send.js";
import { runDailySummary } from "./runDailySummary.js";

vi.mock("../../db/messages.js", () => ({
  loadActiveChatsForWindow: vi.fn(),
}));

vi.mock("../../db/rateLimits.js", () => ({
  cleanupStaleRateLimits: vi.fn(),
}));

vi.mock("../summary/summarizeWindow.js", () => ({
  runTrackedSummarizeWindow: vi.fn(),
}));

vi.mock("../../telegram/send.js", () => ({
  sendMessageToChat: vi.fn(),
}));

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
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
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: true,
      summary: "<b>summary</b>",
    });
    vi.mocked(sendMessageToChat).mockResolvedValue(true);
  });

  it("summarizes and sends for allowlisted active chats", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;
    const windowStart = nowSeconds - 24 * 60 * 60;

    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
    ]);

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const controller = makeController(scheduledTimeMs);
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();

    await expect(
      runDailySummary(controller, env, runtime, waitUntil),
    ).resolves.toBeUndefined();

    expect(cleanupStaleRateLimits).toHaveBeenCalledWith(env, nowSeconds);
    expect(loadActiveChatsForWindow).toHaveBeenCalledWith(
      env,
      windowStart,
      nowSeconds,
    );
    expect(runTrackedSummarizeWindow).toHaveBeenCalledWith(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart,
      windowEnd: nowSeconds,
      command: { type: "summary", fromHours: 24, toHours: 0 },
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_DAILY_CRON,
        waitUntil,
      },
    });
    expect(sendMessageToChat).toHaveBeenCalledWith(
      "bot-token",
      -1001,
      "<b>Daily Summary (Auto, last 24h)</b>\n\n<b>summary</b>",
    );
  });

  it("skips non-allowlisted chats without summarizing or sending", async () => {
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

    await expect(
      runDailySummary(controller, env, runtime),
    ).resolves.toBeUndefined();

    expect(loadActiveChatsForWindow).toHaveBeenCalledWith(
      env,
      windowStart,
      nowSeconds,
    );
    expect(runTrackedSummarizeWindow).toHaveBeenCalledTimes(1);
    expect(runTrackedSummarizeWindow).toHaveBeenCalledWith(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart,
      windowEnd: nowSeconds,
      command: { type: "summary", fromHours: 24, toHours: 0 },
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_DAILY_CRON,
      },
    });
    expect(sendMessageToChat).toHaveBeenCalledTimes(1);
    expect(sendMessageToChat).toHaveBeenCalledWith(
      "bot-token",
      -1001,
      "<b>Daily Summary (Auto, last 24h)</b>\n\n<b>summary</b>",
    );
  });

  it("throws partial failure when one chat fails dispatch but continues others", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;

    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
      { chatId: -1002, chatUsername: "group_b" },
    ]);

    vi.mocked(runTrackedSummarizeWindow)
      .mockResolvedValueOnce({ ok: true, summary: "<b>a</b>" })
      .mockResolvedValueOnce({ ok: true, summary: "<b>b</b>" });
    vi.mocked(sendMessageToChat)
      .mockResolvedValueOnce(true)
      .mockResolvedValueOnce(false);

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
      expect(thrownError.message).toContain(
        "telegram send failed for chat -1002",
      );
    }

    expect(runTrackedSummarizeWindow).toHaveBeenCalledTimes(2);
    expect(sendMessageToChat).toHaveBeenCalledTimes(2);
  });

  it("continues dispatch when cleanup fails", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;
    const windowStart = nowSeconds - 24 * 60 * 60;

    vi.mocked(cleanupStaleRateLimits).mockRejectedValue(
      new Error("cleanup failed"),
    );
    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
    ]);

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const controller = makeController(scheduledTimeMs);

    await expect(
      runDailySummary(controller, env, runtime),
    ).resolves.toBeUndefined();

    expect(loadActiveChatsForWindow).toHaveBeenCalledWith(
      env,
      windowStart,
      nowSeconds,
    );
    expect(runTrackedSummarizeWindow).toHaveBeenCalledTimes(1);
    expect(sendMessageToChat).toHaveBeenCalledTimes(1);
  });

  it("skips sending when degraded mode is active", async () => {
    const nowSeconds = 2_000_000;
    const scheduledTimeMs = nowSeconds * 1_000;

    vi.mocked(loadActiveChatsForWindow).mockResolvedValue([
      { chatId: -1001, chatUsername: "group_a" },
    ]);
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: false,
      reason: "degraded",
    });

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const controller = makeController(scheduledTimeMs);

    await expect(
      runDailySummary(controller, env, runtime),
    ).resolves.toBeUndefined();

    expect(runTrackedSummarizeWindow).toHaveBeenCalledTimes(1);
    expect(sendMessageToChat).not.toHaveBeenCalled();
  });
});
