import {
  RATE_LIMIT_CLEANUP_BATCH_SIZE,
  RATE_LIMIT_CLEANUP_MAX_BATCHES,
  RATE_LIMIT_CLEANUP_RETENTION_SECONDS,
  SUMMARY_RATE_LIMIT_CHAT_LIMIT,
  SUMMARY_RATE_LIMIT_USER_LIMIT,
  SUMMARY_RATE_LIMIT_WINDOW_SECONDS,
} from "../config.js";
import type { Env } from "../env.js";

const SUMMARY_CHAT_BUCKET = "summary_chat";
const SUMMARY_USER_IN_CHAT_BUCKET = "summary_user_in_chat";

type CounterRow = {
  count: number;
};

export type SummaryRateLimitResult =
  | { allowed: true }
  | {
      allowed: false;
      scope: "user" | "chat";
      limit: number;
      windowSeconds: number;
      retryAfterSeconds: number;
    };

type RunMetaWithChanges = {
  changes?: number;
};

function windowStartFor(
  timestampSeconds: number,
  windowSeconds: number,
): number {
  return Math.floor(timestampSeconds / windowSeconds) * windowSeconds;
}

function retryAfterSeconds(
  timestampSeconds: number,
  windowStart: number,
  windowSeconds: number,
): number {
  const remaining = windowStart + windowSeconds - timestampSeconds;
  return Math.max(1, remaining);
}

async function incrementWindowCounter(
  env: Env,
  bucket: string,
  scopeKey: string,
  windowStart: number,
  nowSeconds: number,
): Promise<number> {
  const upsert = env.DB.prepare(
    `INSERT INTO rate_limits (
      bucket,
      scope_key,
      window_start,
      count,
      updated_at
    ) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(bucket, scope_key, window_start)
    DO UPDATE SET
      count = count + 1,
      updated_at = excluded.updated_at`,
  ).bind(bucket, scopeKey, windowStart, nowSeconds);

  const select = env.DB.prepare(
    `SELECT count
     FROM rate_limits
     WHERE bucket = ? AND scope_key = ? AND window_start = ?
     LIMIT 1`,
  ).bind(bucket, scopeKey, windowStart);

  const results = await env.DB.batch([upsert, select]);
  const selected = results[1];
  if (!selected) {
    return 0;
  }

  const row = selected.results[0] as CounterRow | undefined;
  return row?.count ?? 0;
}

export async function enforceSummaryRateLimit(
  env: Env,
  chatId: number,
  userId: number | null,
  nowSeconds: number,
): Promise<SummaryRateLimitResult> {
  const windowSeconds = SUMMARY_RATE_LIMIT_WINDOW_SECONDS;
  const windowStart = windowStartFor(nowSeconds, windowSeconds);

  if (userId !== null) {
    const userScopeKey = `${chatId}:${userId}`;
    const userCount = await incrementWindowCounter(
      env,
      SUMMARY_USER_IN_CHAT_BUCKET,
      userScopeKey,
      windowStart,
      nowSeconds,
    );
    if (userCount > SUMMARY_RATE_LIMIT_USER_LIMIT) {
      return {
        allowed: false,
        scope: "user",
        limit: SUMMARY_RATE_LIMIT_USER_LIMIT,
        windowSeconds,
        retryAfterSeconds: retryAfterSeconds(
          nowSeconds,
          windowStart,
          windowSeconds,
        ),
      };
    }
  }

  const chatScopeKey = `${chatId}`;
  const chatCount = await incrementWindowCounter(
    env,
    SUMMARY_CHAT_BUCKET,
    chatScopeKey,
    windowStart,
    nowSeconds,
  );
  if (chatCount > SUMMARY_RATE_LIMIT_CHAT_LIMIT) {
    return {
      allowed: false,
      scope: "chat",
      limit: SUMMARY_RATE_LIMIT_CHAT_LIMIT,
      windowSeconds,
      retryAfterSeconds: retryAfterSeconds(
        nowSeconds,
        windowStart,
        windowSeconds,
      ),
    };
  }

  return { allowed: true };
}

async function deleteStaleRateLimitsBatch(
  env: Env,
  cutoffSeconds: number,
  batchSize: number,
): Promise<number> {
  const result = await env.DB.prepare(
    `DELETE FROM rate_limits
     WHERE rowid IN (
       SELECT rowid
       FROM rate_limits
       WHERE updated_at < ?
       ORDER BY updated_at
       LIMIT ?
     )`,
  )
    .bind(cutoffSeconds, batchSize)
    .run();

  const meta = result.meta as RunMetaWithChanges | undefined;
  const changes = meta?.changes ?? 0;
  return Number.isFinite(changes) ? changes : 0;
}

export async function cleanupStaleRateLimits(
  env: Env,
  nowSeconds: number,
  retentionSeconds: number = RATE_LIMIT_CLEANUP_RETENTION_SECONDS,
): Promise<number> {
  const cutoffSeconds = nowSeconds - retentionSeconds;
  let deleted = 0;

  for (let batch = 0; batch < RATE_LIMIT_CLEANUP_MAX_BATCHES; batch += 1) {
    const removed = await deleteStaleRateLimitsBatch(
      env,
      cutoffSeconds,
      RATE_LIMIT_CLEANUP_BATCH_SIZE,
    );
    if (removed === 0) {
      break;
    }
    deleted += removed;
  }

  return deleted;
}
