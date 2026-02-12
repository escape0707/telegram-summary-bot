const TELEGRAM_API_BASE = "https://api.telegram.org";

export async function sendTelegramMessage(
  token: string,
  chatId: number,
  text: string,
  replyToMessageId?: number
): Promise<boolean> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
    disable_web_page_preview: true
  };
  if (typeof replyToMessageId === "number") {
    body.reply_parameters = {
      message_id: replyToMessageId,
      allow_sending_without_reply: true
    };
  }

  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Failed to sendMessage", errorText);

    // Telegram rejects invalid parse entities with "can't parse entities".
    // For reliability, retry once without parse_mode.
    if (/can't parse entities/i.test(errorText)) {
      const fallbackBody: Record<string, unknown> = {
        chat_id: chatId,
        text: `Summary (unformatted):\n\n${text}`,
        disable_web_page_preview: true
      };
      if (typeof replyToMessageId === "number") {
        fallbackBody.reply_parameters = {
          message_id: replyToMessageId,
          allow_sending_without_reply: true
        };
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
