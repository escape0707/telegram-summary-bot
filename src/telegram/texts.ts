import type { SummaryRateLimitResult } from "../db/rateLimits.js";

const DAILY_SUMMARY_TITLE = "<b>Daily Summary (Auto, last 24h)</b>";

export type StatusSummaryRunTextSnapshot = {
  sinceTs: number | null;
  runCount: number;
  successCount: number;
  failureCount: number;
  totalInputMessageCount: number;
  totalInputChars: number;
  totalOutputChars: number;
  avgLatencyMs: number | null;
  p50LatencyMs: number | null;
  p95LatencyMs: number | null;
};

export type StatusTextSnapshot = {
  uptimeStart: number;
  lastOkTs: number | null;
  errorCount: number;
  lastError: string | null;
  messageCount: number;
  summaryCount: number;
  realUsage: StatusSummaryRunTextSnapshot;
  syntheticBenchmark: StatusSummaryRunTextSnapshot;
};

export function buildDailySummaryMessage(summary: string): string {
  return `${DAILY_SUMMARY_TITLE}\n\n${summary}`;
}

export function buildBlockedChatReplyText(
  chatId: number,
  projectRepoUrl: string,
): string {
  return [
    "<b>This bot instance is restricted.</b>",
    "This deployment only serves chats allowlisted by its operator.",
    `Current chat ID: <code>${chatId}</code>`,
    `To use this bot in your own group, deploy your own instance: ${projectRepoUrl}`,
  ].join("\n");
}

export function buildHelpCommandReplyText(projectRepoUrl: string): string {
  return [
    "<b>Commands</b>",
    "<code>/summary [Nh [Mh]]</code> - Summarize messages in a custom window.",
    "<code>/summaryday</code> - Summarize messages from the last 24h.",
    "<code>/status</code> - Show service health counters.",
    "<code>/help</code> - Show command help and project info.",
    "<code>/start</code> - Show onboarding and self-host guidance.",
    `Project: ${projectRepoUrl}`,
  ].join("\n");
}

export function buildStartCommandReplyText(projectRepoUrl: string): string {
  return [
    "<b>Welcome to Telegram Summary Bot</b>",
    "This bot is self-hosted and operator-managed.",
    "To use it in your own groups, deploy your own instance and allowlist your chat IDs.",
    `Project: ${projectRepoUrl}`,
    "Use /help to see the available commands.",
  ].join("\n");
}

export function buildSummaryRateLimitText(
  rateLimit: Exclude<SummaryRateLimitResult, { allowed: true }>,
): string {
  const target = rateLimit.scope === "user" ? "you" : "this chat";
  const windowMinutes = Math.floor(rateLimit.windowSeconds / 60);

  return [
    `Rate limit exceeded for ${target}.`,
    `Limit: ${rateLimit.limit} summaries per ${windowMinutes} minutes.`,
    `Try again in ${formatRetryAfter(rateLimit.retryAfterSeconds)}.`,
  ].join(" ");
}

export function buildStatusText(
  status: StatusTextSnapshot,
  nowSeconds: number,
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

  const realUsageSection = buildSummaryRunSection(
    "Real usage",
    status.realUsage,
  );
  const syntheticBenchmarkSection = buildSummaryRunSection(
    "Synthetic benchmark",
    status.syntheticBenchmark,
  );

  return [
    "<b>Status</b>",
    `Uptime: ${uptimeText}`,
    `Errors: ${status.errorCount}`,
    `Last OK: ${lastOkText}`,
    `Last error: ${lastErrorText}`,
    `Stored messages: ${status.messageCount}`,
    `Stored summaries: ${status.summaryCount}`,
    "",
    ...realUsageSection,
    "",
    ...syntheticBenchmarkSection,
  ].join("\n");
}

function buildSummaryRunSection(
  sectionTitle: string,
  metrics: StatusSummaryRunTextSnapshot,
): string[] {
  return [
    `<b>${sectionTitle}</b>`,
    `Since: ${formatDate(metrics.sinceTs)}`,
    `Runs: ${metrics.runCount} (ok ${metrics.successCount}, failed ${metrics.failureCount})`,
    `Input messages: ${metrics.totalInputMessageCount}`,
    `Input chars: ${metrics.totalInputChars}`,
    `Output chars: ${metrics.totalOutputChars}`,
    `Latency ms (avg/p50/p95): ${formatNullableNumber(metrics.avgLatencyMs)}/${formatNullableNumber(metrics.p50LatencyMs)}/${formatNullableNumber(metrics.p95LatencyMs)}`,
  ];
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

function formatDate(timestamp: number | null): string {
  if (timestamp === null) {
    return "n/a";
  }

  return new Date(timestamp * 1_000).toISOString().slice(0, 10);
}

function formatNullableNumber(value: number | null): string {
  return value == null ? "n/a" : String(value);
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}
