import { generateSummary } from "../../ai/summary.js";
import { SUMMARY_MODEL } from "../../config.js";
import {
  loadMessagesForSummary,
  type StoredMessage,
} from "../../db/messages.js";
import {
  insertSummaryRun,
  type SummaryRunSource,
  type SummaryRunType,
} from "../../db/summaryRuns.js";
import {
  insertSummary,
  loadLatestSummaryForWindow,
} from "../../db/summaries.js";
import type { Env } from "../../env.js";
import { AppError } from "../../errors/appError.js";
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
  summaryRunContext?: SummaryRunContext;
};

export type SummaryRunContext = {
  source: SummaryRunSource;
  runType: SummaryRunType;
  waitUntil?: ExecutionContext["waitUntil"];
};

type PreparedSummaryInput = {
  cachedSummary: string | null;
  rows: StoredMessage[];
  inputMessageCount: number;
  inputChars: number;
};

function countInputChars(rows: Array<{ text: string | null }>): number {
  return rows.reduce((sum, row) => sum + (row.text?.length ?? 0), 0);
}

function getSummaryRunErrorType(
  result: WindowSummaryResult | undefined,
  thrownError: unknown,
): string | null {
  if (result) {
    return result.ok ? null : result.reason;
  }

  if (thrownError instanceof AppError) {
    return thrownError.code;
  }

  if (thrownError instanceof Error) {
    return thrownError.name || "exception";
  }

  return thrownError == null ? "unknown" : "exception";
}

async function safeInsertSummaryRun(
  env: Env,
  input: SummarizeWindowInput,
  inputMessageCount: number,
  inputChars: number,
  result: WindowSummaryResult | undefined,
  thrownError: unknown,
  startedAtMs: number,
): Promise<void> {
  const summaryRunContext = input.summaryRunContext;
  if (!summaryRunContext) {
    return;
  }

  const writePromise = (async () => {
    try {
      await insertSummaryRun(env, {
        source: summaryRunContext.source,
        runType: summaryRunContext.runType,
        chatId: input.chatId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        windowSeconds: Math.max(0, input.windowEnd - input.windowStart),
        inputMessageCount,
        inputChars,
        inputTokenEstimate: null,
        model: SUMMARY_MODEL,
        latencyMs: Math.max(0, Date.now() - startedAtMs),
        success: result?.ok ?? false,
        errorType: getSummaryRunErrorType(result, thrownError),
        outputChars: result?.ok ? result.summary.length : 0,
        ts: Math.floor(Date.now() / 1_000),
      });
    } catch (error) {
      console.error("Failed to insert summary telemetry", {
        chatId: input.chatId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        error,
      });
    }
  })();

  if (summaryRunContext.waitUntil) {
    summaryRunContext.waitUntil(writePromise);
    return;
  }

  await writePromise;
}

async function safePersistGeneratedSummary(
  env: Env,
  input: SummarizeWindowInput,
  summaryText: string,
): Promise<void> {
  const writePromise = (async () => {
    try {
      await insertSummary(env, {
        chatId: input.chatId,
        windowStart: input.windowStart,
        windowEnd: input.windowEnd,
        summaryText,
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
  })();

  const waitUntil = input.summaryRunContext?.waitUntil;
  if (waitUntil) {
    waitUntil(writePromise);
    return;
  }

  await writePromise;
}

async function prepareSummaryInput(
  env: Env,
  input: SummarizeWindowInput,
): Promise<PreparedSummaryInput> {
  const cachedSummary = await loadLatestSummaryForWindow(
    env,
    input.chatId,
    input.windowStart,
    input.windowEnd,
  );
  if (cachedSummary) {
    return {
      cachedSummary: cachedSummary.summary_text,
      rows: [],
      inputMessageCount: 0,
      inputChars: 0,
    };
  }

  const rows = await loadMessagesForSummary(
    env,
    input.chatId,
    input.windowStart,
    input.windowEnd,
  );
  return {
    cachedSummary: null,
    rows,
    inputMessageCount: rows.length,
    inputChars: countInputChars(rows),
  };
}

async function summarizeFromRows(
  env: Env,
  input: SummarizeWindowInput,
  rows: StoredMessage[],
): Promise<WindowSummaryResult> {
  const summaryResult = await generateSummary(
    env,
    rows.slice().reverse(),
    input.command,
    input.chatId,
    input.chatUsername,
  );
  if (summaryResult.ok) {
    return { ok: true, summary: summaryResult.summary };
  }

  if (summaryResult.reason === "no_text") {
    return { ok: false, reason: "no_text" };
  }

  return { ok: false, reason: "ai_error" };
}

export async function runTrackedSummarizeWindow(
  env: Env,
  input: SummarizeWindowInput,
): Promise<WindowSummaryResult> {
  const startedAtMs = Date.now();
  let inputMessageCount = 0;
  let inputChars = 0;
  let result: WindowSummaryResult | undefined;
  let thrownError: unknown;

  try {
    const prepared = await prepareSummaryInput(env, input);
    inputMessageCount = prepared.inputMessageCount;
    inputChars = prepared.inputChars;

    if (prepared.cachedSummary !== null) {
      result = { ok: true, summary: prepared.cachedSummary };
      return result;
    }

    if (prepared.rows.length === 0) {
      result = { ok: false, reason: "no_messages" };
      return result;
    }

    result = await summarizeFromRows(env, input, prepared.rows);
    if (result.ok) {
      await safePersistGeneratedSummary(env, input, result.summary);
    }
    return result;
  } catch (error) {
    thrownError = error;
    throw error;
  } finally {
    await safeInsertSummaryRun(
      env,
      input,
      inputMessageCount,
      inputChars,
      result,
      thrownError,
      startedAtMs,
    );
  }
}
