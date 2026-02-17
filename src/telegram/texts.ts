import type { SummaryRateLimitResult } from "../db/rateLimits.js";

const DAILY_SUMMARY_TITLE = "<b>Daily Summary (Auto, last 24h)</b>";

export type StatusTextSnapshot = {
  uptimeStart: number;
  lastOkTs: number | null;
  errorCount: number;
  lastError: string | null;
  messageCount: number;
  summaryCount: number;
};

export function buildDailySummaryMessage(summary: string): string {
  return `${DAILY_SUMMARY_TITLE}\n\n${summary}`;
}

export function buildSummaryRateLimitText(
  rateLimit: Exclude<SummaryRateLimitResult, { allowed: true }>
): string {
  const target = rateLimit.scope === "user" ? "you" : "this chat";
  const windowMinutes = Math.floor(rateLimit.windowSeconds / 60);

  return [
    `Rate limit exceeded for ${target}.`,
    `Limit: ${rateLimit.limit} summaries per ${windowMinutes} minutes.`,
    `Try again in ${formatRetryAfter(rateLimit.retryAfterSeconds)}.`
  ].join(" ");
}

export function buildStatusText(
  status: StatusTextSnapshot,
  nowSeconds: number
): string {
  const uptimeSeconds = Math.max(0, nowSeconds - status.uptimeStart);

  const days = Math.floor(uptimeSeconds / 86_400);
  const hours = Math.floor((uptimeSeconds % 86_400) / 3_600);
  const minutes = Math.floor((uptimeSeconds % 3_600) / 60);

  const uptimeText = `${days}d ${hours}h ${minutes}m`;
  const lastOkText = formatTimestamp(status.lastOkTs);
  const lastErrorText = status.lastError
    ? escapeHtml(status.lastError)
    : "none";

  return [
    "<b>Status</b>",
    `Uptime: ${uptimeText}`,
    `Errors: ${status.errorCount}`,
    `Last OK: ${lastOkText}`,
    `Last error: ${lastErrorText}`,
    `Stored messages: ${status.messageCount}`,
    `Stored summaries: ${status.summaryCount}`
  ].join("\n");
}

function formatRetryAfter(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes}m`;
  }
  return `${minutes}m ${remainingSeconds}s`;
}

function formatTimestamp(timestamp: number | null): string {
  if (timestamp === null) {
    return "n/a";
  }

  return new Date(timestamp * 1_000).toISOString();
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
