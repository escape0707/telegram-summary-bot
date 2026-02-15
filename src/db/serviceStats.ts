import type { Env } from "../env";

export type ServiceStatusSnapshot = {
  uptimeStart: number;
  lastOkTs: number | null;
  errorCount: number;
  lastError: string | null;
  messageCount: number;
  summaryCount: number;
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

function normalizeErrorMessage(errorMessage: string): string {
  return errorMessage.replace(/\s+/g, " ").trim().slice(0, MAX_LAST_ERROR_CHARS);
}

export async function markServiceOk(
  env: Env,
  timestampSeconds: number = nowSeconds()
): Promise<void> {
  await env.DB.prepare(
    `UPDATE service_stats
     SET last_ok_ts = ?
     WHERE id = 1`
  )
    .bind(timestampSeconds)
    .run();
}

export async function recordServiceError(
  env: Env,
  errorMessage: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE service_stats
     SET error_count = error_count + 1,
         last_error = ?
     WHERE id = 1`
  )
    .bind(normalizeErrorMessage(errorMessage))
    .run();
}

export async function loadServiceStatusSnapshot(
  env: Env
): Promise<ServiceStatusSnapshot> {
  const currentNowSeconds = nowSeconds();

  const serviceStatsResult = await env.DB.prepare(
    `SELECT uptime_start, last_ok_ts, error_count, last_error
     FROM service_stats
     WHERE id = 1
     LIMIT 1`
  ).first<ServiceStatsRow>();

  const storageCountsResult = await env.DB.prepare(
    `SELECT
      (SELECT COUNT(*) FROM messages) AS message_count,
      (SELECT COUNT(*) FROM summaries) AS summary_count`
  ).first<StorageCountsRow>();

  return {
    uptimeStart: serviceStatsResult?.uptime_start ?? currentNowSeconds,
    lastOkTs: serviceStatsResult?.last_ok_ts ?? null,
    errorCount: serviceStatsResult?.error_count ?? 0,
    lastError: serviceStatsResult?.last_error ?? null,
    messageCount: storageCountsResult?.message_count ?? 0,
    summaryCount: storageCountsResult?.summary_count ?? 0
  };
}
