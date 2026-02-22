import type { SummaryQueueMessage } from "./queue/summaryJobs.js";

export interface Env {
  DB: D1Database;
  AI: Ai;
  SUMMARY_QUEUE?: Queue<SummaryQueueMessage>;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_IDS: string;
  PROJECT_REPO_URL?: string;
}
