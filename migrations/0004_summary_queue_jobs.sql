CREATE TABLE IF NOT EXISTS summary_queue_jobs (
  job_id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  lease_until INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  done_at INTEGER,
  CHECK (status IN ('processing', 'done'))
);

CREATE INDEX IF NOT EXISTS idx_summary_queue_jobs_status_lease
ON summary_queue_jobs (status, lease_until);
