import {
  MAX_MESSAGE_LENGTH,
  MAX_PROMPT_CHARS,
  SUMMARY_MODEL
} from "../config";
import type { Env } from "../env";
import type { StoredMessage } from "../db/messages";
import type { SummaryCommand } from "../telegram/commands";

type SummaryAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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

    const userToken =
      message.user_id !== null ? `user:${message.user_id}` : undefined;
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

export async function generateSummary(
  env: Env,
  messages: StoredMessage[],
  command: SummaryCommand,
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
  return trimmed
    ? { ok: true, summary: trimmed }
    : { ok: false, reason: "ai_error" };
}

