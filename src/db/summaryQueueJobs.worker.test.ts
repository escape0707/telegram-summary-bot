import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import type { Env } from "../env.js";
import {
  claimSummaryQueueJob,
  markSummaryQueueJobDone,
  releaseSummaryQueueJobClaim,
  type SummaryQueueJobClaimResult,
} from "./summaryQueueJobs.js";

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
    `CREATE TABLE IF NOT EXISTS summary_queue_jobs (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      lease_until INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      done_at INTEGER,
      CHECK (status IN ('processing', 'done'))
    )`,
  ).run();

  await env.DB.prepare(
    `CREATE INDEX IF NOT EXISTS idx_summary_queue_jobs_status_lease
      ON summary_queue_jobs (status, lease_until)`,
  ).run();

  await env.DB.prepare("DELETE FROM summary_queue_jobs").run();
});

function expectAcquired(
  claim: SummaryQueueJobClaimResult,
): asserts claim is Extract<
  SummaryQueueJobClaimResult,
  { status: "acquired" }
> {
  expect(claim.status).toBe("acquired");
}

describe("summary queue idempotency", () => {
  it("acquires claim for a new job", async () => {
    const appEnv = testEnv();

    const claim = await claimSummaryQueueJob(appEnv, "job-1", 1_000, 30);

    expect(claim).toEqual({
      status: "acquired",
      leaseUntil: 1_030,
      updatedAt: 1_000,
    });
  });

  it("returns in_flight while claim lease is still active", async () => {
    const appEnv = testEnv();

    await claimSummaryQueueJob(appEnv, "job-1", 1_000, 30);
    const claim = await claimSummaryQueueJob(appEnv, "job-1", 1_010, 30);

    expect(claim).toEqual({ status: "in_flight", leaseUntil: 1_030 });
  });

  it("allows takeover when an existing claim lease is expired", async () => {
    const appEnv = testEnv();

    await claimSummaryQueueJob(appEnv, "job-1", 1_000, 10);
    const claim = await claimSummaryQueueJob(appEnv, "job-1", 1_020, 30);

    expect(claim).toEqual({
      status: "acquired",
      leaseUntil: 1_050,
      updatedAt: 1_020,
    });
  });

  it("returns already_done after job completion is recorded", async () => {
    const appEnv = testEnv();

    const initialClaim = await claimSummaryQueueJob(appEnv, "job-1", 1_000, 30);
    expectAcquired(initialClaim);

    const doneResult = await markSummaryQueueJobDone(
      appEnv,
      "job-1",
      initialClaim.leaseUntil,
      initialClaim.updatedAt,
      1_015,
    );
    expect(doneResult).toEqual({ status: "marked" });

    const claim = await claimSummaryQueueJob(appEnv, "job-1", 1_020, 30);

    expect(claim).toEqual({ status: "already_done" });
  });

  it("releases a processing claim for retry and allows reacquire", async () => {
    const appEnv = testEnv();

    const initialClaim = await claimSummaryQueueJob(appEnv, "job-1", 1_000, 30);
    expectAcquired(initialClaim);
    await releaseSummaryQueueJobClaim(
      appEnv,
      "job-1",
      initialClaim.leaseUntil,
      initialClaim.updatedAt,
    );
    const nextClaim = await claimSummaryQueueJob(appEnv, "job-1", 1_005, 30);

    expect(nextClaim).toEqual({
      status: "acquired",
      leaseUntil: 1_035,
      updatedAt: 1_005,
    });
  });

  it("does not release a newer claim when stale ownership values are used", async () => {
    const appEnv = testEnv();

    const initialClaim = await claimSummaryQueueJob(appEnv, "job-1", 1_000, 5);
    expectAcquired(initialClaim);
    const takeoverClaim = await claimSummaryQueueJob(
      appEnv,
      "job-1",
      1_010,
      30,
    );
    expectAcquired(takeoverClaim);

    await releaseSummaryQueueJobClaim(
      appEnv,
      "job-1",
      initialClaim.leaseUntil,
      initialClaim.updatedAt,
    );
    const stillInFlight = await claimSummaryQueueJob(
      appEnv,
      "job-1",
      1_011,
      30,
    );

    expect(stillInFlight).toEqual({
      status: "in_flight",
      leaseUntil: takeoverClaim.leaseUntil,
    });
  });
});
