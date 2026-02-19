import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import { loadServiceStatusSnapshot } from "./serviceStats.js";

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
    `CREATE TABLE IF NOT EXISTS service_stats (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      uptime_start INTEGER NOT NULL,
      last_ok_ts INTEGER,
      error_count INTEGER NOT NULL DEFAULT 0,
      last_error TEXT
    )`,
  ).run();

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      chat_id INTEGER NOT NULL,
      ts INTEGER NOT NULL
    )`,
  ).run();

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
    `CREATE TABLE IF NOT EXISTS summary_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source TEXT NOT NULL,
      run_type TEXT NOT NULL,
      chat_id INTEGER,
      window_start INTEGER NOT NULL,
      window_end INTEGER NOT NULL,
      window_seconds INTEGER NOT NULL,
      input_message_count INTEGER NOT NULL,
      input_chars INTEGER NOT NULL,
      input_token_estimate INTEGER,
      model TEXT NOT NULL,
      latency_ms INTEGER NOT NULL,
      success INTEGER NOT NULL,
      error_type TEXT,
      output_chars INTEGER NOT NULL,
      ts INTEGER NOT NULL,
      CHECK (source IN ('real_usage', 'synthetic_benchmark')),
      CHECK (run_type IN ('on_demand', 'daily_cron')),
      CHECK (success IN (0, 1)),
      CHECK (
        (success = 1 AND error_type IS NULL) OR
        (success = 0 AND error_type IS NOT NULL)
      )
    )`,
  ).run();

  await env.DB.prepare("DELETE FROM service_stats").run();
  await env.DB.prepare("DELETE FROM messages").run();
  await env.DB.prepare("DELETE FROM summaries").run();
  await env.DB.prepare("DELETE FROM summary_runs").run();
});

describe("loadServiceStatusSnapshot", () => {
  it("loads base service stats with split real/synthetic telemetry", async () => {
    const appEnv = testEnv();

    await env.DB.prepare(
      `INSERT INTO service_stats (id, uptime_start, last_ok_ts, error_count, last_error)
       VALUES (1, ?, ?, ?, ?)`,
    )
      .bind(10_000, 11_000, 3, "latest failure")
      .run();

    await env.DB.prepare(
      `INSERT INTO messages (chat_id, ts)
       VALUES
       (-1001, 20_000),
       (-1002, 20_010)`,
    ).run();

    await env.DB.prepare(
      `INSERT INTO summaries (chat_id, window_start, window_end, summary_text, ts)
       VALUES (-1001, 19_000, 20_000, '<b>summary</b>', 20_005)`,
    ).run();

    await env.DB.prepare(
      `INSERT INTO summary_runs (
        source,
        run_type,
        chat_id,
        window_start,
        window_end,
        window_seconds,
        input_message_count,
        input_chars,
        input_token_estimate,
        model,
        latency_ms,
        success,
        error_type,
        output_chars,
        ts
      ) VALUES
      ('real_usage', 'on_demand', -1001, 19000, 20000, 3600, 10, 2000, NULL, 'model-a', 120, 1, NULL, 300, 20000),
      ('real_usage', 'daily_cron', -1001, 18000, 19000, 3600, 5, 800, NULL, 'model-a', 260, 0, 'ai_error', 0, 20010),
      ('synthetic_benchmark', 'on_demand', NULL, 17000, 18000, 3600, 15, 3000, NULL, 'model-a', 80, 1, NULL, 450, 20020)`,
    ).run();

    const snapshot = await loadServiceStatusSnapshot(appEnv);
    expect(snapshot).toEqual({
      uptimeStart: 10_000,
      lastOkTs: 11_000,
      errorCount: 3,
      lastError: "latest failure",
      messageCount: 2,
      summaryCount: 1,
      realUsage: {
        sinceTs: 20_000,
        runCount: 2,
        successCount: 1,
        failureCount: 1,
        totalInputMessageCount: 15,
        totalInputChars: 2_800,
        totalOutputChars: 300,
        avgLatencyMs: 190,
        p50LatencyMs: 120,
        p95LatencyMs: 260,
      },
      syntheticBenchmark: {
        sinceTs: 20_020,
        runCount: 1,
        successCount: 1,
        failureCount: 0,
        totalInputMessageCount: 15,
        totalInputChars: 3_000,
        totalOutputChars: 450,
        avgLatencyMs: 80,
        p50LatencyMs: 80,
        p95LatencyMs: 80,
      },
    });
  });

  it("returns zeroed telemetry categories when no summary runs exist", async () => {
    const appEnv = testEnv();

    await env.DB.prepare(
      `INSERT INTO service_stats (id, uptime_start, last_ok_ts, error_count, last_error)
       VALUES (1, ?, NULL, 0, NULL)`,
    )
      .bind(10_000)
      .run();

    const snapshot = await loadServiceStatusSnapshot(appEnv);
    expect(snapshot.realUsage).toEqual({
      sinceTs: null,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      totalInputMessageCount: 0,
      totalInputChars: 0,
      totalOutputChars: 0,
      avgLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
    });
    expect(snapshot.syntheticBenchmark).toEqual({
      sinceTs: null,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      totalInputMessageCount: 0,
      totalInputChars: 0,
      totalOutputChars: 0,
      avgLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
    });
  });
});
