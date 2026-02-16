CREATE TABLE IF NOT EXISTS rate_limits (
  bucket TEXT NOT NULL,
  scope_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (bucket, scope_key, window_start)
);

CREATE INDEX IF NOT EXISTS idx_rate_limits_updated_at
ON rate_limits (updated_at);
