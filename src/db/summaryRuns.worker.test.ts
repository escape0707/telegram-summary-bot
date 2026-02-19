import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import {
  countRecentFailedSummaryRuns,
  insertSummaryRun,
  loadSummaryRunStats,
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK,
  SUMMARY_RUN_TYPE_DAILY_CRON,
  SUMMARY_RUN_TYPE_ON_DEMAND,
  type SummaryRunInsert,
} from "./summaryRuns.js";

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

function makeRun(overrides: Partial<SummaryRunInsert> = {}): SummaryRunInsert {
  return {
    source: SUMMARY_RUN_SOURCE_REAL_USAGE,
    runType: SUMMARY_RUN_TYPE_ON_DEMAND,
    chatId: -1001,
    windowStart: 1_000,
    windowEnd: 4_600,
    windowSeconds: 3_600,
    inputMessageCount: 10,
    inputChars: 2_000,
    inputTokenEstimate: 500,
    model: "@cf/mistralai/mistral-small-3.1-24b-instruct",
    latencyMs: 200,
    success: true,
    errorType: null,
    outputChars: 300,
    ts: 2_000,
    ...overrides,
  };
}

beforeEach(async () => {
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

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_summary_runs_source_ts
      ON summary_runs (source, ts)`,
  ).run();

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_summary_runs_success_ts
      ON summary_runs (success, ts)`,
  ).run();

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_summary_runs_run_type_ts
      ON summary_runs (run_type, ts)`,
  ).run();

  await env.DB.prepare("DELETE FROM summary_runs").run();
});

describe("summary run telemetry", () => {
  it("records runs and computes aggregates by source", async () => {
    const appEnv = testEnv();

    await insertSummaryRun(
      appEnv,
      makeRun({
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
        latencyMs: 120,
        success: true,
        errorType: null,
        inputMessageCount: 10,
        inputChars: 2_000,
        outputChars: 300,
        ts: 2_000,
      }),
    );

    await insertSummaryRun(
      appEnv,
      makeRun({
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
        latencyMs: 260,
        success: false,
        errorType: "ai_error",
        inputMessageCount: 5,
        inputChars: 800,
        outputChars: 0,
        ts: 2_010,
      }),
    );

    await insertSummaryRun(
      appEnv,
      makeRun({
        source: SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK,
        runType: SUMMARY_RUN_TYPE_DAILY_CRON,
        chatId: null,
        latencyMs: 80,
        success: true,
        errorType: null,
        inputMessageCount: 15,
        inputChars: 3_000,
        outputChars: 350,
        ts: 2_020,
      }),
    );

    const realUsageStats = await loadSummaryRunStats(
      appEnv,
      SUMMARY_RUN_SOURCE_REAL_USAGE,
      0,
    );
    expect(realUsageStats).toEqual({
      source: SUMMARY_RUN_SOURCE_REAL_USAGE,
      sinceTs: 0,
      firstRunTs: 2_000,
      lastRunTs: 2_010,
      runCount: 2,
      successCount: 1,
      failureCount: 1,
      totalInputMessageCount: 15,
      totalInputChars: 2_800,
      totalOutputChars: 300,
      avgLatencyMs: 190,
      p50LatencyMs: 120,
      p95LatencyMs: 260,
    });

    const syntheticStats = await loadSummaryRunStats(
      appEnv,
      SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK,
      0,
    );
    expect(syntheticStats).toEqual({
      source: SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK,
      sinceTs: 0,
      firstRunTs: 2_020,
      lastRunTs: 2_020,
      runCount: 1,
      successCount: 1,
      failureCount: 0,
      totalInputMessageCount: 15,
      totalInputChars: 3_000,
      totalOutputChars: 350,
      avgLatencyMs: 80,
      p50LatencyMs: 80,
      p95LatencyMs: 80,
    });
  });

  it("counts recent failed runs", async () => {
    const appEnv = testEnv();

    await insertSummaryRun(
      appEnv,
      makeRun({
        success: false,
        errorType: "ai_error",
        ts: 1_000,
      }),
    );

    await insertSummaryRun(
      appEnv,
      makeRun({
        success: false,
        errorType: "send_failed",
        ts: 2_000,
      }),
    );

    await insertSummaryRun(
      appEnv,
      makeRun({
        success: true,
        errorType: null,
        ts: 2_100,
      }),
    );

    const failuresSince1500 = await countRecentFailedSummaryRuns(appEnv, 1_500);
    expect(failuresSince1500).toBe(1);
  });
});
