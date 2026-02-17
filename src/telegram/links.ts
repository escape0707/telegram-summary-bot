export function toInternalChatId(chatId: number): number {
  // Supergroup/channel dialog ids are in the -100... range. For t.me/c links the
  // internal id is the absolute chat id with the -100 prefix removed.
  if (chatId <= -1_000_000_000_000) {
    return -chatId - 1_000_000_000_000;
  }

  // Basic group dialog ids are negative but not in the -100... range.
  if (chatId < 0) {
    return -chatId;
  }

  // Fallback for unexpected inputs (e.g. private chats). Callers should avoid
  // generating message URLs for non-group chats.
  return chatId;
}

export function buildTelegramMessageUrl(options: {
  chatId: number;
  chatUsername: string | undefined;
  messageId: number;
}): string {
  const chatUsername = options.chatUsername?.trim();
  if (chatUsername) {
    return `https://t.me/${chatUsername}/${options.messageId}`;
  }

  const internalChatId = toInternalChatId(options.chatId);
  return `https://t.me/c/${internalChatId}/${options.messageId}`;
}

export function buildTelegramUserLink(options: {
  username: string | undefined;
  userId: number | undefined;
}): { label: string; url: string } {
  const username = options.username?.trim();
  if (username) {
    return {
      label: `@${username}`,
      url: `https://t.me/${username}`,
    };
  }

  if (typeof options.userId === "number") {
    return {
      label: `user:${options.userId}`,
      url: `tg://user?id=${options.userId}`,
    };
  }

  return {
    label: "user:unknown",
    url: "unknown",
  };
}
