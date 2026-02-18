export interface Env {
  DB: D1Database;
  AI: Ai;
  TELEGRAM_WEBHOOK_SECRET: string;
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_ALLOWED_CHAT_IDS: string;
  PROJECT_REPO_URL?: string;
}
