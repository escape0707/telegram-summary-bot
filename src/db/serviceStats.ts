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

export async function loadServiceStatusSnapshot(
  env: Env
): Promise<ServiceStatusSnapshot> {
  const nowSeconds = Math.floor(Date.now() / 1000);

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
    uptimeStart: serviceStatsResult?.uptime_start ?? nowSeconds,
    lastOkTs: serviceStatsResult?.last_ok_ts ?? null,
    errorCount: serviceStatsResult?.error_count ?? 0,
    lastError: serviceStatsResult?.last_error ?? null,
    messageCount: storageCountsResult?.message_count ?? 0,
    summaryCount: storageCountsResult?.summary_count ?? 0
  };
}
