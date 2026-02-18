import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  SUMMARY_RATE_LIMIT_CHAT_LIMIT,
  SUMMARY_RATE_LIMIT_USER_LIMIT,
  SUMMARY_RATE_LIMIT_WINDOW_SECONDS,
} from "../config.js";
import type { Env } from "../env.js";
import { enforceSummaryRateLimit } from "./rateLimits.js";

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

function expectedRetryAfter(nowSeconds: number): number {
  const windowStart =
    Math.floor(nowSeconds / SUMMARY_RATE_LIMIT_WINDOW_SECONDS) *
    SUMMARY_RATE_LIMIT_WINDOW_SECONDS;
  return windowStart + SUMMARY_RATE_LIMIT_WINDOW_SECONDS - nowSeconds;
}

beforeEach(async () => {
  // Preferred once workers-sdk issue #11999 is fixed:
  // await env.DB.exec(`
  //   DROP TABLE IF EXISTS rate_limits;
  //   CREATE TABLE IF NOT EXISTS rate_limits (
  //     bucket TEXT NOT NULL,
  //     scope_key TEXT NOT NULL,
  //     window_start INTEGER NOT NULL,
  //     count INTEGER NOT NULL DEFAULT 0,
  //     updated_at INTEGER NOT NULL,
  //     PRIMARY KEY (bucket, scope_key, window_start)
  //   );
  //   CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at
  //     ON rate_limits (updated_at);
  // `);

  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS rate_limits (
      bucket TEXT NOT NULL,
      scope_key TEXT NOT NULL,
      window_start INTEGER NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (bucket, scope_key, window_start)
    )`,
  ).run();

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at
      ON rate_limits (updated_at)`,
  ).run();

  await env.DB.prepare("DELETE FROM rate_limits").run();
});

describe("enforceSummaryRateLimit", () => {
  it("allows requests within user and chat limits", async () => {
    const appEnv = testEnv();

    for (
      let attempt = 0;
      attempt < SUMMARY_RATE_LIMIT_USER_LIMIT;
      attempt += 1
    ) {
      const result = await enforceSummaryRateLimit(appEnv, -1001, 42, 1_000);
      expect(result).toEqual({ allowed: true });
    }
  });

  it("blocks when per-user-in-chat limit is exceeded", async () => {
    const appEnv = testEnv();
    const nowSeconds = 1_000;

    for (
      let attempt = 0;
      attempt < SUMMARY_RATE_LIMIT_USER_LIMIT;
      attempt += 1
    ) {
      await enforceSummaryRateLimit(appEnv, -1001, 42, nowSeconds);
    }

    const blocked = await enforceSummaryRateLimit(
      appEnv,
      -1001,
      42,
      nowSeconds,
    );
    expect(blocked).toEqual({
      allowed: false,
      scope: "user",
      limit: SUMMARY_RATE_LIMIT_USER_LIMIT,
      windowSeconds: SUMMARY_RATE_LIMIT_WINDOW_SECONDS,
      retryAfterSeconds: expectedRetryAfter(nowSeconds),
    });
  });

  it("blocks when per-chat limit is exceeded", async () => {
    const appEnv = testEnv();
    const nowSeconds = 1_000;

    for (
      let attempt = 0;
      attempt < SUMMARY_RATE_LIMIT_CHAT_LIMIT;
      attempt += 1
    ) {
      await enforceSummaryRateLimit(appEnv, -1001, null, nowSeconds);
    }

    const blocked = await enforceSummaryRateLimit(
      appEnv,
      -1001,
      null,
      nowSeconds,
    );
    expect(blocked).toEqual({
      allowed: false,
      scope: "chat",
      limit: SUMMARY_RATE_LIMIT_CHAT_LIMIT,
      windowSeconds: SUMMARY_RATE_LIMIT_WINDOW_SECONDS,
      retryAfterSeconds: expectedRetryAfter(nowSeconds),
    });
  });

  it("keeps counters isolated per chat scope", async () => {
    const appEnv = testEnv();
    const nowSeconds = 1_000;

    for (
      let attempt = 0;
      attempt < SUMMARY_RATE_LIMIT_CHAT_LIMIT;
      attempt += 1
    ) {
      await enforceSummaryRateLimit(appEnv, -1001, null, nowSeconds);
    }

    const blockedInFirstChat = await enforceSummaryRateLimit(
      appEnv,
      -1001,
      null,
      nowSeconds,
    );
    expect(blockedInFirstChat).toMatchObject({
      allowed: false,
      scope: "chat",
    });

    const allowedInSecondChat = await enforceSummaryRateLimit(
      appEnv,
      -2002,
      null,
      nowSeconds,
    );
    expect(allowedInSecondChat).toEqual({ allowed: true });
  });

  it("resets counters when a new fixed window starts", async () => {
    const appEnv = testEnv();
    const nowSeconds = 1_000;

    for (
      let attempt = 0;
      attempt < SUMMARY_RATE_LIMIT_USER_LIMIT;
      attempt += 1
    ) {
      await enforceSummaryRateLimit(appEnv, -1001, 42, nowSeconds);
    }

    const blocked = await enforceSummaryRateLimit(
      appEnv,
      -1001,
      42,
      nowSeconds,
    );
    expect(blocked).toMatchObject({
      allowed: false,
      scope: "user",
    });

    const nextWindowResult = await enforceSummaryRateLimit(
      appEnv,
      -1001,
      42,
      nowSeconds + SUMMARY_RATE_LIMIT_WINDOW_SECONDS,
    );
    expect(nextWindowResult).toEqual({ allowed: true });
  });
});
