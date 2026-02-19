import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  SUMMARY_AI_DEGRADED_FAILURE_THRESHOLD,
  SUMMARY_MODEL,
} from "../../config.js";
import { generateSummary } from "../../ai/summary.js";
import {
  loadMessagesForSummary,
  type StoredMessage,
} from "../../db/messages.js";
import {
  countRecentAiFailedSummaryRuns,
  insertSummaryRun,
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_TYPE_ON_DEMAND,
} from "../../db/summaryRuns.js";
import {
  insertSummary,
  loadLatestSummaryForWindow,
} from "../../db/summaries.js";
import type { Env } from "../../env.js";
import { runTrackedSummarizeWindow } from "./summarizeWindow.js";

vi.mock("../../db/messages.js", () => ({
  loadMessagesForSummary: vi.fn(),
}));

vi.mock("../../ai/summary.js", () => ({
  generateSummary: vi.fn(),
}));

vi.mock("../../db/summaries.js", () => ({
  insertSummary: vi.fn(),
  loadLatestSummaryForWindow: vi.fn(),
}));

vi.mock("../../db/summaryRuns.js", () => ({
  countRecentAiFailedSummaryRuns: vi.fn(),
  insertSummaryRun: vi.fn(),
  SUMMARY_RUN_SOURCE_REAL_USAGE: "real_usage",
  SUMMARY_RUN_TYPE_ON_DEMAND: "on_demand",
}));

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    PROJECT_REPO_URL: "https://example.com/repo",
  };
}

function makeStoredMessage(
  overrides: Partial<StoredMessage> = {},
): StoredMessage {
  return {
    message_id: 1,
    user_id: 42,
    username: "alice",
    text: "hello",
    ts: 1_000,
    ...overrides,
  };
}

describe("runTrackedSummarizeWindow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(countRecentAiFailedSummaryRuns).mockResolvedValue(0);
    vi.mocked(insertSummary).mockResolvedValue();
    vi.mocked(insertSummaryRun).mockResolvedValue();
    vi.mocked(loadLatestSummaryForWindow).mockResolvedValue(null);
  });

  it("reuses persisted summary for exact-window retries", async () => {
    const env = makeEnv();
    vi.mocked(loadLatestSummaryForWindow).mockResolvedValue({
      id: 1,
      chat_id: -1001,
      window_start: 10_000,
      window_end: 13_600,
      summary_text: "<b>cached</b>",
      ts: 20_000,
    });

    const result = await runTrackedSummarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
    });

    expect(result).toEqual({ ok: true, summary: "<b>cached</b>" });
    expect(loadMessagesForSummary).not.toHaveBeenCalled();
    expect(generateSummary).not.toHaveBeenCalled();
    expect(insertSummary).not.toHaveBeenCalled();
    expect(insertSummaryRun).not.toHaveBeenCalled();
  });

  it("persists summary on successful generation and writes telemetry", async () => {
    const env = makeEnv();
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(20_000);
    vi.mocked(loadMessagesForSummary).mockResolvedValue([makeStoredMessage()]);
    vi.mocked(generateSummary).mockResolvedValue({
      ok: true,
      summary: "<b>summary</b>",
    });

    const result = await runTrackedSummarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
      },
    });

    expect(result).toEqual({ ok: true, summary: "<b>summary</b>" });
    expect(insertSummary).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        chatId: -1001,
        windowStart: 10_000,
        windowEnd: 13_600,
        summaryText: "<b>summary</b>",
      }),
    );
    expect(insertSummaryRun).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
        chatId: -1001,
        windowStart: 10_000,
        windowEnd: 13_600,
        windowSeconds: 3_600,
        inputMessageCount: 1,
        inputChars: 5,
        inputTokenEstimate: null,
        model: SUMMARY_MODEL,
        latencyMs: 0,
        success: true,
        errorType: null,
        outputChars: 14,
        ts: 20,
      }),
    );
    nowSpy.mockRestore();
  });

  it("returns no_messages and records failed telemetry", async () => {
    const env = makeEnv();
    vi.mocked(loadMessagesForSummary).mockResolvedValue([]);

    const result = await runTrackedSummarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
      },
    });

    expect(result).toEqual({ ok: false, reason: "no_messages" });
    expect(generateSummary).not.toHaveBeenCalled();
    expect(insertSummary).not.toHaveBeenCalled();
    expect(insertSummaryRun).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        success: false,
        errorType: "no_messages",
        inputMessageCount: 0,
        inputChars: 0,
        outputChars: 0,
      }),
    );
  });

  it("returns no_text and skips persistence", async () => {
    const env = makeEnv();
    vi.mocked(loadMessagesForSummary).mockResolvedValue([makeStoredMessage()]);
    vi.mocked(generateSummary).mockResolvedValue({
      ok: false,
      reason: "no_text",
    });

    const result = await runTrackedSummarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
    });

    expect(result).toEqual({ ok: false, reason: "no_text" });
    expect(insertSummary).not.toHaveBeenCalled();
  });

  it("returns degraded when recent AI failures exceed threshold", async () => {
    const env = makeEnv();
    vi.mocked(loadMessagesForSummary).mockResolvedValue([makeStoredMessage()]);
    vi.mocked(countRecentAiFailedSummaryRuns).mockResolvedValue(
      SUMMARY_AI_DEGRADED_FAILURE_THRESHOLD,
    );

    const result = await runTrackedSummarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
      },
    });

    expect(result).toEqual({ ok: false, reason: "degraded" });
    expect(generateSummary).not.toHaveBeenCalled();
    expect(insertSummary).not.toHaveBeenCalled();
    expect(insertSummaryRun).toHaveBeenCalledWith(
      env,
      expect.objectContaining({
        success: false,
        errorType: "degraded",
      }),
    );
  });

  it("returns summary even if persistence write fails", async () => {
    const env = makeEnv();
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    vi.mocked(loadMessagesForSummary).mockResolvedValue([makeStoredMessage()]);
    vi.mocked(generateSummary).mockResolvedValue({
      ok: true,
      summary: "<b>summary</b>",
    });
    vi.mocked(insertSummary).mockRejectedValue(new Error("write failed"));

    const result = await runTrackedSummarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
    });

    expect(result).toEqual({ ok: true, summary: "<b>summary</b>" });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to persist generated summary",
      expect.objectContaining({
        chatId: -1001,
        windowStart: 10_000,
        windowEnd: 13_600,
      }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("schedules summary persistence and telemetry with waitUntil without blocking", async () => {
    const env = makeEnv();
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();

    vi.mocked(loadMessagesForSummary).mockResolvedValue([makeStoredMessage()]);
    vi.mocked(generateSummary).mockResolvedValue({
      ok: true,
      summary: "<b>summary</b>",
    });
    vi.mocked(insertSummary).mockReturnValue(
      new Promise<void>(() => undefined),
    );
    vi.mocked(insertSummaryRun).mockReturnValue(
      new Promise<void>(() => undefined),
    );

    const result = await runTrackedSummarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
        waitUntil,
      },
    });

    expect(result).toEqual({ ok: true, summary: "<b>summary</b>" });
    expect(waitUntil).toHaveBeenCalledTimes(2);
    expect(insertSummary).toHaveBeenCalledTimes(1);
    expect(insertSummaryRun).toHaveBeenCalledTimes(1);
  });
});
