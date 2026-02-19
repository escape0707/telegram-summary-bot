import type { Env } from "../env.js";
import {
  loadSummaryRunStats,
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK,
  type SummaryRunSource,
  type SummaryRunStats,
} from "./summaryRuns.js";

export type SummaryRunStatusMetrics = {
  sinceTs: number | null;
  runCount: number;
  successCount: number;
  failureCount: number;
  totalInputMessageCount: number;
  totalInputChars: number;
  totalOutputChars: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type ServiceStatusSnapshot = {
  uptimeStart: number;
  lastOkTs: number | null;
  errorCount: number;
  lastError: string | null;
  messageCount: number;
  summaryCount: number;
  realUsage: SummaryRunStatusMetrics;
  syntheticBenchmark: SummaryRunStatusMetrics;
};

type ServiceStatsRow = {
  uptime_start: number;
  last_ok_ts: number | null;
  error_count: number;
  last_error: string | null;
};

type StorageCountsRow = {
  message_count: number;
  summary_count: number;
};

const MAX_LAST_ERROR_CHARS = 500;

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function emptySummaryRunStatusMetrics(): SummaryRunStatusMetrics {
  return {
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
  };
}

function toSummaryRunStatusMetrics(
  summaryRunStats: SummaryRunStats,
): SummaryRunStatusMetrics {
  return {
    sinceTs: summaryRunStats.firstRunTs,
    runCount: summaryRunStats.runCount,
    successCount: summaryRunStats.successCount,
    failureCount: summaryRunStats.failureCount,
    totalInputMessageCount: summaryRunStats.totalInputMessageCount,
    totalInputChars: summaryRunStats.totalInputChars,
    totalOutputChars: summaryRunStats.totalOutputChars,
    avgLatencyMs: summaryRunStats.avgLatencyMs,
    p50LatencyMs: summaryRunStats.p50LatencyMs,
    p95LatencyMs: summaryRunStats.p95LatencyMs,
  };
}

async function safeLoadSummaryRunStatusMetrics(
  env: Env,
  source: SummaryRunSource,
): Promise<SummaryRunStatusMetrics> {
  try {
    const summaryRunStats = await loadSummaryRunStats(env, source, 0);
    return toSummaryRunStatusMetrics(summaryRunStats);
  } catch (error) {
    console.error("Failed to load summary run stats", { source, error });
    return emptySummaryRunStatusMetrics();
  }
}

function normalizeErrorMessage(errorMessage: string): string {
  return errorMessage
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LAST_ERROR_CHARS);
}

export async function markServiceOk(
  env: Env,
  timestampSeconds: number = nowSeconds(),
): Promise<void> {
  await env.DB.prepare(
    `UPDATE service_stats
     SET last_ok_ts = ?
     WHERE id = 1`,
  )
    .bind(timestampSeconds)
    .run();
}

export async function recordServiceError(
  env: Env,
  errorMessage: string,
): Promise<void> {
  await env.DB.prepare(
    `UPDATE service_stats
     SET error_count = error_count + 1,
         last_error = ?
     WHERE id = 1`,
  )
    .bind(normalizeErrorMessage(errorMessage))
    .run();
}

export async function loadServiceStatusSnapshot(
  env: Env,
): Promise<ServiceStatusSnapshot> {
  const currentNowSeconds = nowSeconds();

  const [
    serviceStatsResult,
    storageCountsResult,
    realUsage,
    syntheticBenchmark,
  ] = await Promise.all([
    env.DB.prepare(
      `SELECT uptime_start, last_ok_ts, error_count, last_error
       FROM service_stats
       WHERE id = 1
       LIMIT 1`,
    ).first<ServiceStatsRow>(),
    env.DB.prepare(
      `SELECT
        (SELECT COUNT(*) FROM messages) AS message_count,
        (SELECT COUNT(*) FROM summaries) AS summary_count`,
    ).first<StorageCountsRow>(),
    safeLoadSummaryRunStatusMetrics(env, SUMMARY_RUN_SOURCE_REAL_USAGE),
    safeLoadSummaryRunStatusMetrics(
      env,
      SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK,
    ),
  ]);

  return {
    uptimeStart: serviceStatsResult?.uptime_start ?? currentNowSeconds,
    lastOkTs: serviceStatsResult?.last_ok_ts ?? null,
    errorCount: serviceStatsResult?.error_count ?? 0,
    lastError: serviceStatsResult?.last_error ?? null,
    messageCount: storageCountsResult?.message_count ?? 0,
    summaryCount: storageCountsResult?.summary_count ?? 0,
    realUsage,
    syntheticBenchmark,
  };
}
