import type { Env } from "../env.js";
import { sendTelegramMessage } from "./api.js";
import type { TelegramMessage } from "./types.js";

type TelegramReplyTarget = Pick<TelegramMessage, "chat" | "message_id">;

export function getBotToken(env: Env): string | undefined {
  const token = env.TELEGRAM_BOT_TOKEN.trim();
  if (!token) {
    return undefined;
  }

  return token;
}

export async function sendReplyToMessage(
  botToken: string,
  message: TelegramReplyTarget,
  text: string,
): Promise<boolean> {
  return sendTelegramMessage(
    botToken,
    message.chat.id,
    text,
    message.message_id,
  );
}

export async function sendMessageToChat(
  botToken: string,
  chatId: number,
  text: string,
): Promise<boolean> {
  return sendTelegramMessage(botToken, chatId, text);
}
