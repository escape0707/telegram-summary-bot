CREATE TABLE IF NOT EXISTS summary_runs (
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
);

CREATE INDEX IF NOT EXISTS idx_summary_runs_source_ts
ON summary_runs (source, ts);

CREATE INDEX IF NOT EXISTS idx_summary_runs_success_ts
ON summary_runs (success, ts);

CREATE INDEX IF NOT EXISTS idx_summary_runs_run_type_ts
ON summary_runs (run_type, ts);
