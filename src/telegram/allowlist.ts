export function parseAllowedChatIds(
  raw: string | undefined,
): ReadonlySet<number> {
  const trimmed = raw?.trim();
  if (!trimmed) {
    return new Set<number>();
  }

  const values = trimmed
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const ids = new Set<number>();
  for (const value of values) {
    if (!/^-?\d+$/.test(value)) {
      throw new Error(
        `Invalid chat id in TELEGRAM_ALLOWED_CHAT_IDS: "${value}"`,
      );
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) {
      throw new Error(
        `Chat id is out of range in TELEGRAM_ALLOWED_CHAT_IDS: "${value}"`,
      );
    }

    ids.add(parsed);
  }

  return ids;
}

export function isChatAllowed(
  chatId: number,
  allowedChatIds: ReadonlySet<number>,
): boolean {
  return allowedChatIds.has(chatId);
}
