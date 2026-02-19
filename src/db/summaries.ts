import type { Env } from "../env.js";

export type SummaryInsert = {
  chatId: number;
  windowStart: number;
  windowEnd: number;
  summaryText: string;
  ts: number;
};

export type StoredSummary = {
  id: number;
  chat_id: number;
  window_start: number;
  window_end: number;
  summary_text: string;
  ts: number;
};

export async function insertSummary(
  env: Env,
  summary: SummaryInsert,
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO summaries (
      chat_id,
      window_start,
      window_end,
      summary_text,
      ts
    ) VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      summary.chatId,
      summary.windowStart,
      summary.windowEnd,
      summary.summaryText,
      summary.ts,
    )
    .run();
}

export async function loadSummaryHistoryForChat(
  env: Env,
  chatId: number,
  limit = 20,
): Promise<StoredSummary[]> {
  const safeLimit = Number.isFinite(limit)
    ? Math.max(1, Math.min(Math.floor(limit), 100))
    : 20;

  const result = await env.DB.prepare(
    `SELECT id, chat_id, window_start, window_end, summary_text, ts
     FROM summaries
     WHERE chat_id = ?
     ORDER BY ts DESC, id DESC
     LIMIT ?`,
  )
    .bind(chatId, safeLimit)
    .all<StoredSummary>();

  return result.results;
}
