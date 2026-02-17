import { generateSummary } from "../../ai/summary.js";
import { loadMessagesForSummary } from "../../db/messages.js";
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
  input: SummarizeWindowInput
): Promise<WindowSummaryResult> {
  const rows = await loadMessagesForSummary(
    env,
    input.chatId,
    input.windowStart,
    input.windowEnd
  );
  if (rows.length === 0) {
    return { ok: false, reason: "no_messages" };
  }

  const summaryResult = await generateSummary(
    env,
    rows.slice().reverse(),
    input.command,
    input.chatId,
    input.chatUsername
  );
  if (summaryResult.ok) {
    return { ok: true, summary: summaryResult.summary };
  }
  if (summaryResult.reason === "no_text") {
    return { ok: false, reason: "no_text" };
  }

  return { ok: false, reason: "ai_error" };
}
