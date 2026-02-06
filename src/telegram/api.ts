const TELEGRAM_API_BASE = "https://api.telegram.org";

export type SendTelegramMessageOptions = {
  parseMode?: "MarkdownV2";
  disableWebPagePreview?: boolean;
};

export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  replyToMessageId: number,
  options?: SendTelegramMessageOptions
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    reply_parameters: {
      message_id: replyToMessageId,
      allow_sending_without_reply: true
    }
  };
  if (options?.parseMode) {
    body.parse_mode = options.parseMode;
  }
  if (options?.disableWebPagePreview) {
    body.disable_web_page_preview = true;
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to sendMessage", errorText);

    // Telegram rejects invalid MarkdownV2 with "can't parse entities".
    // For reliability, retry once without parse_mode.
    if (
      options?.parseMode === "MarkdownV2" &&
      /can'?t parse entities/i.test(errorText)
    ) {
      const fallbackBody: Record<string, unknown> = {
        chat_id: chatId,
        text: `Summary (unformatted):\n\n${text}`,
        reply_parameters: {
          message_id: replyToMessageId,
          allow_sending_without_reply: true
        }
      };
      if (options.disableWebPagePreview) {
        fallbackBody.disable_web_page_preview = true;
      }

      const fallbackResponse = await fetch(
        `${TELEGRAM_API_BASE}/bot${token}/sendMessage`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(fallbackBody)
        }
      );

      if (!fallbackResponse.ok) {
        console.error(
          "Failed to sendMessage (fallback)",
          await fallbackResponse.text()
        );
        return false;
      }

      return true;
    }

    return false;
  }

  return true;
}

