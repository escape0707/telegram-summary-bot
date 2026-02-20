export type TelegramChatType = "private" | "group" | "supergroup" | "channel";

export type TelegramUser = {
  id: number;
  username?: string;
};

export type TelegramChat = {
  id: number;
  type: TelegramChatType;
  username?: string;
};

export type TelegramMessageEntity = {
  type:
    | "mention"
    | "hashtag"
    | "cashtag"
    | "bot_command"
    | "url"
    | "email"
    | "phone_number"
    | "bold"
    | "italic"
    | "underline"
    | "strikethrough"
    | "spoiler"
    | "blockquote"
    | "expandable_blockquote"
    | "code"
    | "pre"
    | "text_link"
    | "text_mention"
    | "custom_emoji";
  offset: number;
  length: number;
};

export type TelegramMessageOriginUser = {
  type: "user";
  date: number;
  sender_user: TelegramUser;
};

export type TelegramMessageOriginHiddenUser = {
  type: "hidden_user";
  date: number;
  sender_user_name: string;
};

export type TelegramMessageOriginChat = {
  type: "chat";
  date: number;
  sender_chat: TelegramChat;
  author_signature?: string;
};

export type TelegramMessageOriginChannel = {
  type: "channel";
  date: number;
  chat: TelegramChat;
  message_id: number;
  author_signature?: string;
};

export type TelegramMessageOrigin =
  | TelegramMessageOriginUser
  | TelegramMessageOriginHiddenUser
  | TelegramMessageOriginChat
  | TelegramMessageOriginChannel;

export type TelegramMessage = {
  message_id: number;
  date: number;
  text?: string;
  caption?: string;
  entities?: TelegramMessageEntity[];
  caption_entities?: TelegramMessageEntity[];
  from?: TelegramUser;
  chat: TelegramChat;
  reply_to_message?: {
    message_id: number;
  };
  forward_origin?: TelegramMessageOrigin;
  is_automatic_forward?: true;
};

export type TelegramUpdate = {
  update_id: number;
  message?: TelegramMessage;
  edited_message?: TelegramMessage;
};

export const GROUP_CHAT_TYPES: TelegramChatType[] = ["group", "supergroup"];
