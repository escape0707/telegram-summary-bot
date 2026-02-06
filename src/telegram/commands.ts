import { MAX_SUMMARY_HOURS } from "../config";
import type { TelegramMessage, TelegramMessageEntity } from "./types";

export type SummaryCommand = { type: "summary"; fromHours: number; toHours: number };
export type StatusCommand = { type: "status" };

export type ParsedCommand = SummaryCommand | StatusCommand;

export type CommandParseResult =
  | { ok: true; command: ParsedCommand }
  | {
      ok: false;
      reason: "unknown command" | "invalid arguments" | "exceeds max hours";
    };

export type CommandParseErrorReason = Extract<
  CommandParseResult,
  { ok: false }
>["reason"];

export function buildSummaryErrorText(reason: CommandParseErrorReason): string {
  if (reason === "exceeds max hours") {
    return `Max summary window is ${MAX_SUMMARY_HOURS}h.`;
  }
  return `Usage: /summary [Nh [Mh]] (N=1..${MAX_SUMMARY_HOURS}, M=0..${MAX_SUMMARY_HOURS}, N > M).`;
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

export function parseTelegramCommand(text: string): CommandParseResult {
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

export function hasBotCommandAtStart(
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

