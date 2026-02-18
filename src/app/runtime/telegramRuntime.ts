import { DEFAULT_PROJECT_REPO_URL } from "../../config.js";
import type { Env } from "../../env.js";
import { AppError, ErrorCode } from "../../errors/appError.js";
import { parseAllowedChatIds } from "../../telegram/allowlist.js";

export type TelegramRuntime = {
  botToken: string;
  allowedChatIds: ReadonlySet<number>;
  projectRepoUrl: string;
};

export function requireWebhookSecret(env: Env): string {
  const secret = env.TELEGRAM_WEBHOOK_SECRET.trim();
  if (!secret) {
    throw new AppError(
      ErrorCode.ConfigMissing,
      "TELEGRAM_WEBHOOK_SECRET is not configured",
    );
  }

  return secret;
}

export function requireTelegramRuntime(env: Env): TelegramRuntime {
  return {
    botToken: readRequiredBotToken(env),
    allowedChatIds: readAllowedChatIds(env),
    projectRepoUrl: readProjectRepoUrl(env),
  };
}

function readRequiredBotToken(env: Env): string {
  const token = env.TELEGRAM_BOT_TOKEN.trim();
  if (!token) {
    throw new AppError(
      ErrorCode.ConfigMissing,
      "TELEGRAM_BOT_TOKEN is not configured",
    );
  }

  return token;
}

function readAllowedChatIds(env: Env): ReadonlySet<number> {
  try {
    return parseAllowedChatIds(env.TELEGRAM_ALLOWED_CHAT_IDS);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AppError(
      ErrorCode.ConfigMissing,
      `TELEGRAM_ALLOWED_CHAT_IDS is misconfigured (${detail})`,
    );
  }
}

function readProjectRepoUrl(env: Env): string {
  const configured = env.PROJECT_REPO_URL?.trim();
  if (configured) {
    return configured;
  }

  return DEFAULT_PROJECT_REPO_URL;
}
