import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import {
  insertSummary,
  loadLatestSummaryForWindow,
  loadSummaryHistoryForChat,
} from "./summaries.js";

function testEnv(): Env {
  return {
    DB: env.DB,
    AI: {} as Ai,
    TELEGRAM_WEBHOOK_SECRET: "test-secret",
    TELEGRAM_BOT_TOKEN: "test-token",
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    PROJECT_REPO_URL: "https://example.com/repo",
  };
}

beforeEach(async () => {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS summaries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      summary_text TEXT NOT NULL,
      ts INTEGER NOT NULL
    )`,
  ).run();

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_summaries_chat_window
      ON summaries (chat_id, window_start, window_end)`,
  ).run();

  await env.DB.prepare("DELETE FROM summaries").run();
});

describe("summaries db helpers", () => {
  it("stores and loads summary history ordered by newest first", async () => {
    const appEnv = testEnv();

    await insertSummary(appEnv, {
      chatId: -1001,
      windowStart: 1_000,
      windowEnd: 4_600,
      summaryText: "<b>older</b>",
      ts: 2_000,
    });

    await insertSummary(appEnv, {
      chatId: -1001,
      windowStart: 2_000,
      windowEnd: 5_600,
      summaryText: "<b>newer</b>",
      ts: 3_000,
    });

    const history = await loadSummaryHistoryForChat(appEnv, -1001);
    expect(history).toHaveLength(2);
    expect(history.map((row) => row.summary_text)).toEqual([
      "<b>newer</b>",
      "<b>older</b>",
    ]);
  });

  it("returns chat-scoped history and enforces sane limit bounds", async () => {
    const appEnv = testEnv();

    for (let index = 0; index < 3; index += 1) {
      await insertSummary(appEnv, {
        chatId: -1001,
        windowStart: 1_000 + index * 3_600,
        windowEnd: 4_600 + index * 3_600,
        summaryText: `<b>chat1-${index}</b>`,
        ts: 1_000 + index,
      });
    }

    await insertSummary(appEnv, {
      chatId: -2002,
      windowStart: 1_000,
      windowEnd: 4_600,
      summaryText: "<b>chat2</b>",
      ts: 2_000,
    });

    const chat1Limited = await loadSummaryHistoryForChat(appEnv, -1001, 2);
    expect(chat1Limited).toHaveLength(2);
    expect(chat1Limited.every((row) => row.chat_id === -1001)).toBe(true);

    const fallbackLimit = await loadSummaryHistoryForChat(appEnv, -1001, 0);
    expect(fallbackLimit).toHaveLength(1);
  });

  it("loads latest persisted summary for an exact window", async () => {
    const appEnv = testEnv();

    await insertSummary(appEnv, {
      chatId: -1001,
      windowStart: 1_000,
      windowEnd: 4_600,
      summaryText: "<b>first</b>",
      ts: 2_000,
    });
    await insertSummary(appEnv, {
      chatId: -1001,
      windowStart: 1_000,
      windowEnd: 4_600,
      summaryText: "<b>latest</b>",
      ts: 3_000,
    });
    await insertSummary(appEnv, {
      chatId: -1001,
      windowStart: 2_000,
      windowEnd: 5_600,
      summaryText: "<b>other-window</b>",
      ts: 4_000,
    });

    const latest = await loadLatestSummaryForWindow(appEnv, -1001, 1_000, 4_600);
    expect(latest?.summary_text).toBe("<b>latest</b>");

    const missing = await loadLatestSummaryForWindow(appEnv, -1001, 9_999, 10_000);
    expect(missing).toBeNull();
  });
});
