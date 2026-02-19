import type { Env } from "../env.js";

export const SUMMARY_RUN_SOURCE_REAL_USAGE = "real_usage";
export const SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK = "synthetic_benchmark";

export type SummaryRunSource =
  | typeof SUMMARY_RUN_SOURCE_REAL_USAGE
  | typeof SUMMARY_RUN_SOURCE_SYNTHETIC_BENCHMARK;

export const SUMMARY_RUN_TYPE_ON_DEMAND = "on_demand";
export const SUMMARY_RUN_TYPE_DAILY_CRON = "daily_cron";

export type SummaryRunType =
  | typeof SUMMARY_RUN_TYPE_ON_DEMAND
  | typeof SUMMARY_RUN_TYPE_DAILY_CRON;

export type SummaryRunInsert = {
  source: SummaryRunSource;
  runType: SummaryRunType;
  chatId: number | null;
  windowStart: number;
  windowEnd: number;
  windowSeconds: number;
  inputMessageCount: number;
  inputChars: number;
  inputTokenEstimate: number | null;
  model: string;
  latencyMs: number;
  success: boolean;
  errorType: string | null;
  outputChars: number;
  ts: number;
};

export type SummaryRunStats = {
  source: SummaryRunSource;
  sinceTs: number;
  firstRunTs: number | null;
  lastRunTs: number | null;
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

type SummaryRunAggregateRow = {
  run_count: number;
  first_run_ts: number | null;
  last_run_ts: number | null;
  success_count: number | null;
  failure_count: number | null;
  total_input_message_count: number | null;
  total_input_chars: number | null;
  total_output_chars: number | null;
  avg_latency_ms: number | null;
};

type CountRow = {
  count: number;
};

type LatencyRow = {
  latency_ms: number;
};

function sanitizeErrorType(errorType: string | null): string | null {
  if (errorType === null) {
    return null;
  }

  const normalized = errorType.replace(/\s+/g, "_").trim();
  return normalized ? normalized.slice(0, 80) : "unknown";
}

function percentileFromSorted(
  sortedValues: number[],
  percentile: number,
): number | null {
  if (sortedValues.length === 0) {
    return null;
  }

  const rank = Math.ceil(sortedValues.length * percentile);
  const index = Math.max(0, rank - 1);
  return sortedValues[index] ?? null;
}

export async function insertSummaryRun(
  env: Env,
  run: SummaryRunInsert,
): Promise<void> {
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
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      run.source,
      run.runType,
      run.chatId,
      run.windowStart,
      run.windowEnd,
      run.windowSeconds,
      run.inputMessageCount,
      run.inputChars,
      run.inputTokenEstimate,
      run.model,
      run.latencyMs,
      run.success ? 1 : 0,
      sanitizeErrorType(run.errorType),
      run.outputChars,
      run.ts,
    )
    .run();
}

export async function countRecentFailedSummaryRuns(
  env: Env,
  sinceTs: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM summary_runs
     WHERE success = 0 AND ts >= ?`,
  )
    .bind(sinceTs)
    .first<CountRow>();

  return result?.count ?? 0;
}

export async function countRecentAiFailedSummaryRuns(
  env: Env,
  sinceTs: number,
  source?: SummaryRunSource,
): Promise<number> {
  if (source) {
    const result = await env.DB.prepare(
      `SELECT COUNT(*) AS count
       FROM summary_runs
       WHERE success = 0
         AND error_type = 'ai_error'
         AND ts >= ?
         AND source = ?`,
    )
      .bind(sinceTs, source)
      .first<CountRow>();

    return result?.count ?? 0;
  }

  const result = await env.DB.prepare(
    `SELECT COUNT(*) AS count
     FROM summary_runs
     WHERE success = 0
       AND error_type = 'ai_error'
       AND ts >= ?`,
  )
    .bind(sinceTs)
    .first<CountRow>();

  return result?.count ?? 0;
}

export async function loadSummaryRunStats(
  env: Env,
  source: SummaryRunSource,
  sinceTs: number,
): Promise<SummaryRunStats> {
  const aggregate = await env.DB.prepare(
    `SELECT
      COUNT(*) AS run_count,
      MIN(ts) AS first_run_ts,
      MAX(ts) AS last_run_ts,
      SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) AS success_count,
      SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS failure_count,
      SUM(input_message_count) AS total_input_message_count,
      SUM(input_chars) AS total_input_chars,
      SUM(output_chars) AS total_output_chars,
      AVG(latency_ms) AS avg_latency_ms
     FROM summary_runs
     WHERE source = ? AND ts >= ?`,
  )
    .bind(source, sinceTs)
    .first<SummaryRunAggregateRow>();

  const latencyRows = await env.DB.prepare(
    `SELECT latency_ms
     FROM summary_runs
     WHERE source = ? AND ts >= ?
     ORDER BY latency_ms ASC`,
  )
    .bind(source, sinceTs)
    .all<LatencyRow>();

  const latencies = latencyRows.results.map((row) => row.latency_ms);

  return {
    source,
    sinceTs,
    firstRunTs: aggregate?.first_run_ts ?? null,
    lastRunTs: aggregate?.last_run_ts ?? null,
    runCount: aggregate?.run_count ?? 0,
    successCount: aggregate?.success_count ?? 0,
    failureCount: aggregate?.failure_count ?? 0,
    totalInputMessageCount: aggregate?.total_input_message_count ?? 0,
    totalInputChars: aggregate?.total_input_chars ?? 0,
    totalOutputChars: aggregate?.total_output_chars ?? 0,
    avgLatencyMs:
      aggregate?.avg_latency_ms == null
        ? null
        : Math.round(aggregate.avg_latency_ms),
    p50LatencyMs: percentileFromSorted(latencies, 0.5),
    p95LatencyMs: percentileFromSorted(latencies, 0.95),
  };
}
