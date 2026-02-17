import {
  MAX_MESSAGE_LENGTH,
  MAX_PROMPT_CHARS,
  SUMMARY_MODEL
} from "../config.js";
import type { Env } from "../env.js";
import type { StoredMessage } from "../db/messages.js";
import type { SummaryCommand } from "../telegram/commands.js";
import {
  buildTelegramMessageUrl,
  buildTelegramUserLink
} from "../telegram/links.js";

type SummaryAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const SUMMARY_MAX_TOKENS = 1200;
const SUMMARY_PROMPT_BUDGET_TOKENS = Math.floor(SUMMARY_MAX_TOKENS / 2);

function extractWorkersAiText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;

  // Observed outputs:
  // - Granite: { choices: [{ message: { content: "..." } }] }
  // - Mistral: { response: "..." }
  const record = result as {
    response?: unknown;
    choices?: Array<{ message?: { content?: unknown } }>;
  };

  if (typeof record.response === "string") {
    return record.response;
  }

  const content = record.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : undefined;
}

function formatMessagesForSummary(
  messages: StoredMessage[],
  chatId: number,
  chatUsername: string | undefined
): string {
  let usedChars = 0;
  const lines: string[] = [];

  for (const message of messages) {
    if (!message.text) {
      continue;
    }

    const cleaned = message.text.replace(/\s+/g, " ").trim();
    if (!cleaned) {
      continue;
    }

    const userLink = buildTelegramUserLink({
      username: message.username ?? undefined,
      userId: message.user_id ?? undefined
    });

    const clipped = cleaned.slice(0, MAX_MESSAGE_LENGTH);
    const messageUrl = buildTelegramMessageUrl({
      chatId,
      chatUsername,
      messageId: message.message_id
    });
    const line = `- ${JSON.stringify({
      user_label: userLink.label,
      user_url: userLink.url,
      message_url: messageUrl,
      text: clipped
    })}`;

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
  chatId: number,
  chatUsername: string | undefined
): Promise<
  | { ok: true; summary: string }
  | { ok: false; reason: "no_text" | "ai_error" }
> {
  const content = formatMessagesForSummary(messages, chatId, chatUsername);
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
          "You summarize Telegram group chats into topic clusters.",
          "Return ONLY Telegram HTML (no Markdown, no code fences, no commentary).",
          "",
          "Input lines are JSON objects after '- ' with fields:",
          "user_label, user_url, message_url, text",
          "",
          "Write 2-6 lines. Each line format:",
          "<b>TOPIC</b>: <a href=\"USER_URL\">USER_LABEL</a> <a href=\"MESSAGE_URL\">VERB</a> OBJECT; ...",
          "",
          "Constraints:",
          "- 1-4 SVO entries per topic line.",
          "- Reuse USER_LABEL and USER_URL exactly from input; skip rows where user_url is 'unknown'.",
          "- Reuse MESSAGE_URL exactly from input; never invent URLs, participants, or facts.",
          "- VERB short (e.g. says/adds/asks/agrees/disagrees/reports/clarifies/suggests).",
          "- OBJECT is a short summary of what was said.",
          "- Escape '&', '<', and '>' in topic/object text.",
          "- No raw URLs outside href and no Markdown syntax.",
          `- Keep output strictly less than ${SUMMARY_PROMPT_BUDGET_TOKENS} tokens; if tight, use fewer lines/entries and never leave unclosed HTML tags.`
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
      messages: messagesPrompt,
      max_tokens: SUMMARY_MAX_TOKENS
    });
  } catch (error) {
    console.error("Workers AI run failed", error);
    return { ok: false, reason: "ai_error" };
  }

  const rawText = extractWorkersAiText(result);
  if (rawText === undefined) {
    console.error("Unexpected Workers AI output format");
    return { ok: false, reason: "ai_error" };
  }

  const trimmed = rawText.trim();
  return trimmed
    ? { ok: true, summary: trimmed }
    : { ok: false, reason: "ai_error" };
}
