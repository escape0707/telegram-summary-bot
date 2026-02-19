import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateSummary } from "../../ai/summary.js";
import { loadMessagesForSummary, type StoredMessage } from "../../db/messages.js";
import {
  insertSummary,
  loadLatestSummaryForWindow,
} from "../../db/summaries.js";
import type { Env } from "../../env.js";
import { summarizeWindow } from "./summarizeWindow.js";

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

describe("summarizeWindow", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(insertSummary).mockResolvedValue();
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

    const result = await summarizeWindow(env, {
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
  });

  it("persists summary on successful generation", async () => {
    const env = makeEnv();
    vi.mocked(loadMessagesForSummary).mockResolvedValue([makeStoredMessage()]);
    vi.mocked(generateSummary).mockResolvedValue({
      ok: true,
      summary: "<b>summary</b>",
    });

    const result = await summarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
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
  });

  it("returns no_messages and skips generation/persistence", async () => {
    const env = makeEnv();
    vi.mocked(loadMessagesForSummary).mockResolvedValue([]);

    const result = await summarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
    });

    expect(result).toEqual({ ok: false, reason: "no_messages" });
    expect(generateSummary).not.toHaveBeenCalled();
    expect(insertSummary).not.toHaveBeenCalled();
  });

  it("returns no_text and skips persistence", async () => {
    const env = makeEnv();
    vi.mocked(loadMessagesForSummary).mockResolvedValue([makeStoredMessage()]);
    vi.mocked(generateSummary).mockResolvedValue({
      ok: false,
      reason: "no_text",
    });

    const result = await summarizeWindow(env, {
      chatId: -1001,
      chatUsername: "group_a",
      windowStart: 10_000,
      windowEnd: 13_600,
      command: { type: "summary", fromHours: 1, toHours: 0 },
    });

    expect(result).toEqual({ ok: false, reason: "no_text" });
    expect(insertSummary).not.toHaveBeenCalled();
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

    const result = await summarizeWindow(env, {
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
});
