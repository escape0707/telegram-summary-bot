export const HEALTH_PATH = "/health";
export const TELEGRAM_PATH = "/telegram";
export const TELEGRAM_SECRET_HEADER = "X-Telegram-Bot-Api-Secret-Token";

export const SUMMARY_MODEL = "@cf/mistralai/mistral-small-3.1-24b-instruct";

export const MAX_SUMMARY_HOURS = 24 * 7;
export const MAX_MESSAGES_FOR_SUMMARY = 200;
export const MAX_MESSAGE_LENGTH = 280;
export const MAX_PROMPT_CHARS = 8000;

export const SUMMARY_RATE_LIMIT_WINDOW_SECONDS = 10 * 60;
export const SUMMARY_RATE_LIMIT_USER_LIMIT = 3;
export const SUMMARY_RATE_LIMIT_CHAT_LIMIT = 20;

export const RATE_LIMIT_CLEANUP_RETENTION_SECONDS = 3 * 24 * 60 * 60;
export const RATE_LIMIT_CLEANUP_BATCH_SIZE = 500;
export const RATE_LIMIT_CLEANUP_MAX_BATCHES = 20;

export const DEFAULT_PROJECT_REPO_URL =
  "https://github.com/escape0707/telegram-summary-bot";
