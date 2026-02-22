import { sendTelegramMessage } from "./api.js";
import type { TelegramMessage } from "./types.js";

type TelegramReplyTarget = Pick<TelegramMessage, "chat" | "message_id">;

export async function sendReplyToMessage(
  botToken: string,
  message: TelegramReplyTarget,
  text: string,
): Promise<boolean> {
  return await sendTelegramMessage(
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
  return await sendTelegramMessage(botToken, chatId, text);
}

export async function sendReplyToChatMessage(
  botToken: string,
  chatId: number,
  replyToMessageId: number,
  text: string,
): Promise<boolean> {
  return await sendTelegramMessage(botToken, chatId, text, replyToMessageId);
}
