import {
  GROUP_CHAT_TYPES,
  type TelegramMessage,
  type TelegramMessageEntity,
  type TelegramUpdate
} from "./telegram/types";
import { sendTelegramMessage } from "./telegram/api";
import {
  HEALTH_PATH,
  MAX_MESSAGE_LENGTH,
  MAX_MESSAGES_FOR_SUMMARY,
  MAX_PROMPT_CHARS,
  MAX_SUMMARY_HOURS,
  SUMMARY_MODEL,
  TELEGRAM_PATH,
  TELEGRAM_SECRET_HEADER
} from "./config";
import type { Env } from "./env";

type SummaryAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type ParsedCommand =
  | { type: "summary"; fromHours: number; toHours: number }
  | { type: "status" };

type CommandParseResult =
  | { ok: true; command: ParsedCommand }
  | {
      ok: false;
      reason: "unknown command" | "invalid arguments" | "exceeds max hours";
    };

type CommandParseErrorReason = Extract<
  CommandParseResult,
  { ok: false }
>["reason"];

function buildSummaryErrorText(reason: CommandParseErrorReason): string {
  if (reason === "exceeds max hours") {
    return `Max summary window is ${MAX_SUMMARY_HOURS}h.`;
  }
  return `Usage: /summary [Nh [Mh]] (N=1..${MAX_SUMMARY_HOURS}, M=0..${MAX_SUMMARY_HOURS}, N > M).`;
}

type StoredMessage = {
  message_id: number;
  user_id: number | null;
  username: string | null;
  text: string | null;
  ts: number;
};

function extractWorkersAiText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;

  // Observed Granite output (wrangler tail):
  // { choices: [{ message: { content: "..." } }] }
  const record = result as {
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  const content = record.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : undefined;
}

async function loadMessagesForSummary(
  env: Env,
  chatId: number,
  windowStart: number,
  windowEnd: number
): Promise<StoredMessage[]> {
  const result = await env.DB.prepare(
    `SELECT message_id, user_id, username, text, ts
     FROM messages
     WHERE chat_id = ? AND ts BETWEEN ? AND ?
     ORDER BY ts DESC
     LIMIT ${MAX_MESSAGES_FOR_SUMMARY}`
  )
    .bind(chatId, windowStart, windowEnd)
    .all<StoredMessage>();

  return (result.results ?? []) as StoredMessage[];
}

function formatMessagesForSummary(
  messages: StoredMessage[],
  chatUsername: string | undefined
): string {
  let usedChars = 0;
  const lines: string[] = [];

  for (const message of messages) {
    if (!message.text) {
      continue;
    }

    const userToken = message.user_id !== null ? `user:${message.user_id}` : undefined;
    const displayName = message.username ? `@${message.username}` : userToken ?? "unknown";
    const author =
      userToken && displayName !== userToken
        ? `${displayName} (${userToken})`
        : displayName;
    const cleaned = message.text.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }
    const clipped = cleaned.slice(0, MAX_MESSAGE_LENGTH);
    const source = chatUsername
      ? `https://t.me/${chatUsername}/${message.message_id}`
      : `message:${message.message_id}`;
    const line = `- ${author}: ${clipped} (${source})`;

    if (usedChars + line.length + 1 > MAX_PROMPT_CHARS) {
      break;
    }

    lines.push(line);
    usedChars += line.length + 1;
  }

  return lines.join("\n");
}

async function generateSummary(
  env: Env,
  messages: StoredMessage[],
  command: Extract<ParsedCommand, { type: "summary" }>,
  chatUsername: string | undefined
): Promise<
  | { ok: true; summary: string }
  | { ok: false; reason: "no_text" | "ai_error" }
> {
  const content = formatMessagesForSummary(messages, chatUsername);
  if (!content) {
    return { ok: false, reason: "no_text" };
  }

  const windowText =
    command.toHours === 0
      ? `the last ${command.fromHours} hours`
      : `${command.fromHours} to ${command.toHours} hours ago`;

  const messagesPrompt: SummaryAiMessage[] = [
    {
      role: "system",
      content:
        [
          "You summarize Telegram group chats by clustering messages into topics.",
          "",
          "Return 3-7 bullet points formatted as Telegram MarkdownV2, and nothing else.",
          "",
          "Exact output format (one bullet per line):",
          "• *Topic*: [@alice](tg://user?id=123) and [user:456](tg://user?id=456) talked about XXXX [1](URL) [2](URL)",
          "",
          "Input format notes:",
          "- Each input message line ends with a source URL in parentheses: (https://t.me/<chat>/<message_id>)",
          "- The author prefix is either '@username (user:<id>)' or 'user:<id>' if no username is available",
          "- Use the numeric <id> from user:<id> when building tg://user?id=<id> links",
          "",
          "Rules:",
          "- Each bullet must start with '• ' (do NOT use '-' bullets).",
          "- Use single-asterisk bold for the topic name (e.g. *Topic*). Do NOT use '**bold**'.",
          "- After the colon, start with 1-3 clickable participant mentions, then the summary text.",
          "- Always mention participants as inline links like [username](tg://user?id=user_id).",
          "- Use the username from the input as the link text if available (e.g. @alice). If a user has no username, use user:<id> as the link text.",
          "- Use only user ids that appear in the input as (user:<id>). Do NOT invent ids or usernames.",
          "- Do NOT use the hyphen character '-' anywhere in the bullet text. Rewrite hyphenated phrases using spaces (e.g. 'LLM-based' => 'LLM based').",
          "- End each bullet with 1-3 inline links like [1](URL). Use only URLs from the input (they appear in parentheses at the end of each message line).",
          "- Do not show raw URLs outside the [n](URL) links.",
          "- Do not put URLs in parentheses like (https://...). Only use the [n](URL) inline link format.",
          "- MarkdownV2 escaping: in the bullet text (everything except inside the (URL) part of links), escape these characters with a backslash: _ * [ ] ( ) ~ ` > # + - = | { } . !",
          "- Avoid '.' and '!' entirely if possible (do not end bullets with punctuation).",
          "- Mention who said what, but prefer paraphrasing over quoting raw message text to reduce escaping errors.",
          "- Do not invent details."
        ].join("\n")
    },
    {
      role: "user",
      content: `Messages from ${windowText}:\n\n${content}`
    }
  ];

  let result: unknown;
  try {
    result = await env.AI.run(SUMMARY_MODEL, {
      messages: messagesPrompt
    });
  } catch (error) {
    console.error("Workers AI run failed", error);
    return { ok: false, reason: "ai_error" };
  }

  const rawText = extractWorkersAiText(result);
  if (rawText === undefined) {
    console.error("Unexpected Workers AI output format", result);
    return { ok: false, reason: "ai_error" };
  }

  const trimmed = rawText.trim();
  return trimmed ? { ok: true, summary: trimmed } : { ok: false, reason: "ai_error" };
}

function parseSummaryHours(token: string): number | undefined {
  const trimmed = token.trim().toLowerCase();
  if (!trimmed) {
    return undefined;
  }

  const numericPart = trimmed.endsWith("h") ? trimmed.slice(0, -1) : trimmed;
  if (!/^\d+$/.test(numericPart)) {
    return undefined;
  }

  const parsed = Number(numericPart);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }
  return parsed;
}

function parseTelegramCommand(text: string): CommandParseResult {
  const trimmed = text.trim();
  const [rawCommand, ...tokens] = trimmed.split(/\s+/);
  const commandToken = rawCommand.replace(/^\//, "");
  if (!commandToken) {
    return { ok: false, reason: "unknown command" };
  }

  const command = commandToken.split("@", 1)[0].toLowerCase();
  switch (command) {
    case "summary":
      const rawFromHours =
        tokens.length >= 1 ? parseSummaryHours(tokens[0]) : 1;
      const rawToHours =
        tokens.length >= 2 ? parseSummaryHours(tokens[1]) : 0;

      if (rawFromHours === undefined || rawToHours === undefined) {
        return { ok: false, reason: "invalid arguments" };
      }

      const normalizedFromHours = Math.max(1, rawFromHours);
      const normalizedToHours = Math.max(0, rawToHours);

      if (
        normalizedFromHours > MAX_SUMMARY_HOURS ||
        normalizedToHours > MAX_SUMMARY_HOURS
      ) {
        return { ok: false, reason: "exceeds max hours" };
      }
      if (normalizedFromHours <= normalizedToHours) {
        return { ok: false, reason: "invalid arguments" };
      }

      return {
        ok: true,
        command: {
          type: "summary",
          fromHours: normalizedFromHours,
          toHours: normalizedToHours
        }
      };
    case "summaryday":
      return {
        ok: true,
        command: { type: "summary", fromHours: 24, toHours: 0 }
      };
    case "status":
      return { ok: true, command: { type: "status" } };
    default:
      return { ok: false, reason: "unknown command" };
  }
}

function hasBotCommandAtStart(
  message: TelegramMessage
): message is TelegramMessage & {
  text: string;
  entities: TelegramMessageEntity[];
} {
  if (!message.text || !message.entities || message.entities.length === 0) {
    return false;
  }

  return message.entities.some(
    (entity) => entity.type === "bot_command" && entity.offset === 0
  );
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === HEALTH_PATH) {
      return new Response("ok", { status: 200 });
    }

    if (pathname === TELEGRAM_PATH) {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }

      const expectedSecret = env.TELEGRAM_WEBHOOK_SECRET?.trim();
      if (!expectedSecret) {
        return new Response("webhook secret not configured", { status: 500 });
      }

      const providedSecret = request.headers.get(TELEGRAM_SECRET_HEADER);
      if (providedSecret !== expectedSecret) {
        return new Response("unauthorized", { status: 401 });
      }

      let update: TelegramUpdate;
      try {
        update = await request.json<TelegramUpdate>();
      } catch {
        return new Response("bad request", { status: 400 });
      }

      if (!update || typeof update.update_id !== "number") {
        return new Response("bad request", { status: 400 });
      }

      const message = update.message ?? update.edited_message;
      if (message && GROUP_CHAT_TYPES.includes(message.chat.type)) {
        const text = message.text ?? message.caption ?? null;
        const replyToMessageId = message.reply_to_message?.message_id ?? null;
        const userId = message.from?.id ?? null;
        const username = message.from?.username ?? null;
        const chatUsername = message.chat.username ?? null;

        try {
          await env.DB.prepare(
            `INSERT OR IGNORE INTO messages (
              chat_id,
              chat_username,
              message_id,
              user_id,
              username,
              text,
              ts,
              reply_to_message_id
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          )
            .bind(
              message.chat.id,
              chatUsername,
              message.message_id,
              userId,
              username,
              text,
              message.date,
              replyToMessageId
            )
            .run();
        } catch (error) {
          console.error("Failed to insert message", error);
          return new Response("internal error", { status: 500 });
        }
      }

      if (message && hasBotCommandAtStart(message)) {
        const commandResult = parseTelegramCommand(message.text);
        let replyText: string | undefined;
        let replyParseMode: "MarkdownV2" | undefined;

        if (commandResult.ok) {
          if (commandResult.command.type === "summary") {
            const windowStart =
              message.date - commandResult.command.fromHours * 60 * 60;
            const windowEnd =
              message.date - commandResult.command.toHours * 60 * 60;

            let rows: StoredMessage[];
            try {
              rows = await loadMessagesForSummary(
                env,
                message.chat.id,
                windowStart,
                windowEnd
              );
            } catch (error) {
              console.error("Failed to load messages for summary", error);
              replyText = "Failed to load messages for summary.";
              rows = [];
            }

            if (!replyText) {
              if (rows.length === 0) {
                replyText = "No messages found in that window.";
              } else {
                const summaryResult = await generateSummary(
                  env,
                  rows.slice().reverse(),
                  commandResult.command,
                  message.chat.username
                );
                if (summaryResult.ok) {
                  replyText = summaryResult.summary;
                  replyParseMode = "MarkdownV2";
                } else if (summaryResult.reason === "no_text") {
                  replyText = "No text messages found in that window.";
                } else {
                  replyText = "Failed to generate summary (check logs).";
                }
              }
            }
          }
        } else {
          if (commandResult.reason !== "unknown command") {
            replyText = buildSummaryErrorText(commandResult.reason);
          }
          console.warn("Invalid command format", commandResult.reason);
        }

        if (replyText) {
          const botToken = env.TELEGRAM_BOT_TOKEN?.trim();
          if (!botToken) {
            console.error("TELEGRAM_BOT_TOKEN is not configured");
            return new Response("internal error", { status: 500 });
          }

          const sent = await sendTelegramMessage(
            botToken,
            message.chat.id,
            replyText,
            message.message_id,
            replyParseMode
              ? { parseMode: replyParseMode, disableWebPagePreview: true }
              : undefined
          );
          if (!sent) {
            return new Response("internal error", { status: 502 });
          }
        }
      }

      return new Response("ok", { status: 200 });
    }

    return new Response("not found", { status: 404 });
  }
} satisfies ExportedHandler<Env>;
