import {
  MAX_MESSAGE_LENGTH,
  MAX_PROMPT_CHARS,
  SUMMARY_MODEL
} from "../config";
import type { Env } from "../env";
import type { StoredMessage } from "../db/messages";
import type { SummaryCommand } from "../telegram/commands";
import {
  buildTelegramMessageUrl,
  buildTelegramUserLink
} from "../telegram/links";

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
      user_label: userLink?.label ?? "unknown",
      user_url: userLink?.url ?? "unknown",
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
          "You summarize Telegram group chats by clustering messages into topics.",
          "",
          "Return Telegram HTML only (no Markdown, no code fences, no extra prose).",
          "",
          "Output format (one topic per line):",
          "<b>Topic</b>: <a href=\"USER_URL\">USER_LABEL</a> <a href=\"MESSAGE_URL\">VERB</a> object; <a href=\"USER_URL\">USER_LABEL</a> <a href=\"MESSAGE_URL\">VERB</a> object",
          "",
          "Input format notes:",
          "- Each input message line is a JSON object after '- ' with fields: user_label, user_url, message_url, text",
          "- user_url is precomputed and is either https://t.me/<username>, tg://user?id=<id>, or 'unknown'",
          "",
          "Rules:",
          "- Produce 2-6 topic lines.",
          "- Each line starts with <b>topic</b>:",
          "- After the colon, provide 1-4 SVO entries separated by '; '.",
          "- SVO entry format: <a href=\"USER_URL\">USER_LABEL</a> <a href=\"MESSAGE_URL\">VERB</a> OBJECT",
          "- USER_LABEL and USER_URL must be copied exactly from input user_label and user_url values.",
          "- If user_url is 'unknown', do not include that user as a participant.",
          "- MESSAGE_URL must be copied from input message_url values; never invent URLs.",
          "- VERB must be short and human (for example: says, adds, asks, agrees, disagrees, reports, clarifies, suggests).",
          "- OBJECT is a short paraphrase of what was said.",
          "- Mention who said what, but prefer paraphrasing over quoting raw message text.",
          "- Use only participant labels/urls from the input. Do NOT invent participants.",
          "- Escape '&', '<', and '>' in topic/object text using HTML entities.",
          "- Do not include raw URLs outside href attributes.",
          "- Do not use Markdown syntax anywhere.",
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
