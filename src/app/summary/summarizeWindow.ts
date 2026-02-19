import { generateSummary } from "../../ai/summary.js";
import { loadMessagesForSummary } from "../../db/messages.js";
import { insertSummary } from "../../db/summaries.js";
import type { Env } from "../../env.js";
import type { SummaryCommand } from "../../telegram/commands.js";

export type WindowSummaryResult =
  | { ok: true; summary: string }
  | { ok: false; reason: "no_messages" | "no_text" | "ai_error" };

type SummarizeWindowInput = {
  chatId: number;
  chatUsername: string | undefined;
  windowStart: number;
  windowEnd: number;
  command: SummaryCommand;
};

export async function summarizeWindow(
  env: Env,
  input: SummarizeWindowInput,
): Promise<WindowSummaryResult> {
  const rows = await loadMessagesForSummary(
    env,
    input.chatId,
    input.windowStart,
    input.windowEnd,
  );
  if (rows.length === 0) {
    return { ok: false, reason: "no_messages" };
  }

  const summaryResult = await generateSummary(
    env,
    rows.slice().reverse(),
    input.command,
    input.chatId,
    input.chatUsername,
  );
  if (summaryResult.ok) {
    try {
      await insertSummary(env, {
        chatId: input.chatId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        summaryText: summaryResult.summary,
        ts: Math.floor(Date.now() / 1_000),
      });
    } catch (error) {
      // Fail-open: summary generation succeeded, so we still return the summary.
      console.error("Failed to persist generated summary", {
        chatId: input.chatId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        error,
      });
    }

    return { ok: true, summary: summaryResult.summary };
  }
  if (summaryResult.reason === "no_text") {
    return { ok: false, reason: "no_text" };
  }

  return { ok: false, reason: "ai_error" };
}
