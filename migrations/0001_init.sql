CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  chat_username TEXT,
  message_id INTEGER NOT NULL,
  user_id INTEGER,
  username TEXT,
  text TEXT,
  ts INTEGER NOT NULL,
  reply_to_message_id INTEGER,
  UNIQUE(chat_id, message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_ts ON messages (chat_id, ts);

CREATE TABLE IF NOT EXISTS summaries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_id INTEGER NOT NULL,
  window_start INTEGER NOT NULL,
  window_end INTEGER NOT NULL,
  summary_text TEXT NOT NULL,
  ts INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_chat_window ON summaries (chat_id, window_start, window_end);

CREATE TABLE IF NOT EXISTS service_stats (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  uptime_start INTEGER NOT NULL,
  last_ok_ts INTEGER,
  error_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

INSERT OR IGNORE INTO service_stats (id, uptime_start, last_ok_ts, error_count, last_error)
VALUES (1, strftime('%s', 'now'), NULL, 0, NULL);
