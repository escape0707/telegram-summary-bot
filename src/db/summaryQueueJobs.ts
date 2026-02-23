import type { Env } from "../env.js";

const SUMMARY_QUEUE_JOB_STATUS_PROCESSING = "processing";
const SUMMARY_QUEUE_JOB_STATUS_DONE = "done";

type SummaryQueueJobStatus =
  | typeof SUMMARY_QUEUE_JOB_STATUS_PROCESSING
  | typeof SUMMARY_QUEUE_JOB_STATUS_DONE;

type SummaryQueueJobRow = {
  status: SummaryQueueJobStatus;
  lease_until: number;
};

export type SummaryQueueJobClaimResult =
  | { status: "acquired"; leaseUntil: number; updatedAt: number }
  | { status: "already_done" }
  | { status: "in_flight"; leaseUntil: number };

export type SummaryQueueJobDoneResult =
  | { status: "marked" }
  | { status: "already_done" }
  | { status: "lost_claim" };

export async function claimSummaryQueueJob(
  env: Env,
  jobId: string,
  nowTs: number,
  leaseSeconds: number,
): Promise<SummaryQueueJobClaimResult> {
  const leaseUntil = nowTs + Math.max(1, leaseSeconds);

  const insertResult = await env.DB.prepare(
    `INSERT OR IGNORE INTO summary_queue_jobs (
      job_id,
      status,
      lease_until,
      updated_at,
      done_at
    ) VALUES (?, ?, ?, ?, NULL)`,
  )
    .bind(jobId, SUMMARY_QUEUE_JOB_STATUS_PROCESSING, leaseUntil, nowTs)
    .run();

  if (insertResult.meta.changes > 0) {
    return { status: "acquired", leaseUntil, updatedAt: nowTs };
  }

  const row = await env.DB.prepare(
    `SELECT status, lease_until
     FROM summary_queue_jobs
     WHERE job_id = ?`,
  )
    .bind(jobId)
    .first<SummaryQueueJobRow>();

  if (!row) {
    // Race-safe fallback: retry claim on next queue delivery.
    return { status: "in_flight", leaseUntil };
  }

  if (row.status === SUMMARY_QUEUE_JOB_STATUS_DONE) {
    return { status: "already_done" };
  }

  if (row.lease_until > nowTs) {
    return { status: "in_flight", leaseUntil: row.lease_until };
  }

  const takeoverResult = await env.DB.prepare(
    `UPDATE summary_queue_jobs
     SET status = ?,
         lease_until = ?,
         updated_at = ?,
         done_at = NULL
     WHERE job_id = ?
       AND status = ?
       AND lease_until <= ?`,
  )
    .bind(
      SUMMARY_QUEUE_JOB_STATUS_PROCESSING,
      leaseUntil,
      nowTs,
      jobId,
      SUMMARY_QUEUE_JOB_STATUS_PROCESSING,
      nowTs,
    )
    .run();

  if (takeoverResult.meta.changes > 0) {
    return { status: "acquired", leaseUntil, updatedAt: nowTs };
  }

  const latest = await env.DB.prepare(
    `SELECT status, lease_until
     FROM summary_queue_jobs
     WHERE job_id = ?`,
  )
    .bind(jobId)
    .first<SummaryQueueJobRow>();

  if (latest?.status === SUMMARY_QUEUE_JOB_STATUS_DONE) {
    return { status: "already_done" };
  }

  return {
    status: "in_flight",
    leaseUntil: latest?.lease_until ?? leaseUntil,
  };
}

export async function markSummaryQueueJobDone(
  env: Env,
  jobId: string,
  claimLeaseUntil: number,
  claimUpdatedAt: number,
  nowTs: number,
): Promise<SummaryQueueJobDoneResult> {
  const updateResult = await env.DB.prepare(
    `UPDATE summary_queue_jobs
     SET status = ?,
         lease_until = ?,
         updated_at = ?,
         done_at = ?
     WHERE job_id = ?
       AND status = ?
       AND lease_until = ?
       AND updated_at = ?`,
  )
    .bind(
      SUMMARY_QUEUE_JOB_STATUS_DONE,
      nowTs,
      nowTs,
      nowTs,
      jobId,
      SUMMARY_QUEUE_JOB_STATUS_PROCESSING,
      claimLeaseUntil,
      claimUpdatedAt,
    )
    .run();

  if (updateResult.meta.changes > 0) {
    return { status: "marked" };
  }

  const row = await env.DB.prepare(
    `SELECT status
     FROM summary_queue_jobs
     WHERE job_id = ?`,
  )
    .bind(jobId)
    .first<{ status: SummaryQueueJobStatus }>();

  if (row?.status === SUMMARY_QUEUE_JOB_STATUS_DONE) {
    return { status: "already_done" };
  }

  return { status: "lost_claim" };
}

export async function releaseSummaryQueueJobClaim(
  env: Env,
  jobId: string,
  claimLeaseUntil: number,
  claimUpdatedAt: number,
): Promise<void> {
  await env.DB.prepare(
    `DELETE FROM summary_queue_jobs
     WHERE job_id = ?
       AND status = ?
       AND lease_until = ?
       AND updated_at = ?`,
  )
    .bind(
      jobId,
      SUMMARY_QUEUE_JOB_STATUS_PROCESSING,
      claimLeaseUntil,
      claimUpdatedAt,
    )
    .run();
}
