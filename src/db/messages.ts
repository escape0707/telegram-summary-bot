import { MAX_MESSAGES_FOR_SUMMARY } from "../config.js";
import type { Env } from "../env.js";

export type StoredMessage = {
  message_id: number;
  user_id: number | null;
  username: string | null;
  text: string | null;
  ts: number;
};

export type MessageInsert = {
  chatId: number;
  chatUsername: string | null;
  messageId: number;
  userId: number | null;
  username: string | null;
  text: string | null;
  ts: number;
  replyToMessageId: number | null;
};

export type ActiveChat = {
  chatId: number;
  chatUsername: string | null;
};

type ActiveChatRow = {
  chat_id: number;
  chat_username: string | null;
};

export async function insertMessage(env: Env, message: MessageInsert): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO messages (
      chat_id,
      chat_username,
      message_id,
      user_id,
      username,
      text,
      ts,
      reply_to_message_id
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      message.chatId,
      message.chatUsername,
      message.messageId,
      message.userId,
      message.username,
      message.text,
      message.ts,
      message.replyToMessageId
    )
    .run();
}

export async function loadMessagesForSummary(
  env: Env,
  chatId: number,
  windowStart: number,
  windowEnd: number
): Promise<StoredMessage[]> {
  const result = await env.DB.prepare(
    `SELECT message_id, user_id, username, text, ts
     FROM messages
     WHERE chat_id = ? AND ts BETWEEN ? AND ?
     ORDER BY ts DESC
     LIMIT ${MAX_MESSAGES_FOR_SUMMARY}`
  )
    .bind(chatId, windowStart, windowEnd)
    .all<StoredMessage>();

  return (result.results ?? []) as StoredMessage[];
}

export async function loadActiveChatsForWindow(
  env: Env,
  windowStart: number,
  windowEnd: number
): Promise<ActiveChat[]> {
  const result = await env.DB.prepare(
    `SELECT chat_id, MAX(chat_username) AS chat_username
     FROM messages
     WHERE ts BETWEEN ? AND ?
     GROUP BY chat_id`
  )
    .bind(windowStart, windowEnd)
    .all<ActiveChatRow>();

  return (result.results ?? []).map((row) => ({
    chatId: row.chat_id,
    chatUsername: row.chat_username
  }));
}
