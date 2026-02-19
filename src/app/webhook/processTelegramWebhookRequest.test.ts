import { beforeEach, describe, expect, it, vi } from "vitest";
import { TELEGRAM_SECRET_HEADER } from "../../config.js";
import type { Env } from "../../env.js";
import { insertMessage } from "../../db/messages.js";
import { enforceSummaryRateLimit } from "../../db/rateLimits.js";
import { loadServiceStatusSnapshot } from "../../db/serviceStats.js";
import {
  SUMMARY_RUN_SOURCE_REAL_USAGE,
  SUMMARY_RUN_TYPE_ON_DEMAND,
} from "../../db/summaryRuns.js";
import type { TelegramRuntime } from "../runtime/telegramRuntime.js";
import { runTrackedSummarizeWindow } from "../summary/summarizeWindow.js";
import { sendReplyToMessage } from "../../telegram/send.js";
import type {
  TelegramChatType,
  TelegramMessage,
} from "../../telegram/types.js";
import { processTelegramWebhookRequest } from "./processTelegramWebhookRequest.js";

vi.mock("../../db/messages.js", () => ({
  insertMessage: vi.fn(),
}));

vi.mock("../../db/rateLimits.js", () => ({
  enforceSummaryRateLimit: vi.fn(),
}));

vi.mock("../../db/serviceStats.js", () => ({
  loadServiceStatusSnapshot: vi.fn(),
}));

vi.mock("../summary/summarizeWindow.js", () => ({
  runTrackedSummarizeWindow: vi.fn(),
}));

vi.mock("../../telegram/send.js", () => ({
  sendReplyToMessage: vi.fn(),
}));

type UpdateOptions = {
  chatId?: number;
  chatType?: TelegramChatType;
  chatUsername?: string;
  fromUserId?: number | null;
  fromUsername?: string;
  date?: number;
  messageId?: number;
};

type MessageUpdate = {
  update_id: number;
  message: TelegramMessage;
};

const WEBHOOK_SECRET = "webhook-secret";
const PROJECT_REPO_URL = "https://example.com/repo";

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
    TELEGRAM_WEBHOOK_SECRET: WEBHOOK_SECRET,
    TELEGRAM_BOT_TOKEN: "bot-token",
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    PROJECT_REPO_URL,
  };
}

function makeRuntime(allowedChatIds: ReadonlySet<number>): TelegramRuntime {
  return {
    botToken: "bot-token",
    allowedChatIds,
    projectRepoUrl: PROJECT_REPO_URL,
  };
}

function makeStatusSnapshot(): Awaited<
  ReturnType<typeof loadServiceStatusSnapshot>
> {
  return {
    uptimeStart: 1_000,
    lastOkTs: 2_000,
    errorCount: 1,
    lastError: "none",
    messageCount: 5,
    summaryCount: 2,
    realUsage: {
      sinceTs: 900,
      runCount: 3,
      successCount: 2,
      failureCount: 1,
      totalInputMessageCount: 50,
      totalInputChars: 2_200,
      totalOutputChars: 600,
      avgLatencyMs: 300,
      p50LatencyMs: 280,
      p95LatencyMs: 420,
    },
    syntheticBenchmark: {
      sinceTs: null,
      runCount: 0,
      successCount: 0,
      failureCount: 0,
      totalInputMessageCount: 0,
      totalInputChars: 0,
      totalOutputChars: 0,
      avgLatencyMs: null,
      p50LatencyMs: null,
      p95LatencyMs: null,
    },
  };
}

function firstCommandTokenLength(text: string): number {
  const [token] = text.trim().split(/\s+/, 1);
  return token?.length ?? 0;
}

function makeUpdate(
  text: string,
  isCommand: boolean,
  options: UpdateOptions = {},
): MessageUpdate {
  const message: TelegramMessage = {
    message_id: options.messageId ?? 10,
    date: options.date ?? 1_000,
    text,
    ...(options.fromUserId !== null
      ? {
          from: {
            id: options.fromUserId ?? 42,
            username: options.fromUsername ?? "alice",
          },
        }
      : {}),
    chat: {
      id: options.chatId ?? -1001,
      type: options.chatType ?? "supergroup",
      ...(options.chatUsername !== undefined
        ? { username: options.chatUsername }
        : {}),
    },
    ...(isCommand
      ? {
          entities: [
            {
              type: "bot_command",
              offset: 0,
              length: firstCommandTokenLength(text),
            },
          ],
        }
      : {}),
  };

  return {
    update_id: 1,
    message,
  };
}

function makeCommandUpdate(
  text: string,
  options: UpdateOptions = {},
): MessageUpdate {
  return makeUpdate(text, true, options);
}

function makeTextUpdate(
  text: string,
  options: UpdateOptions = {},
): MessageUpdate {
  return makeUpdate(text, false, options);
}

function makeRequest(
  update: unknown,
  providedSecret = WEBHOOK_SECRET,
): Request {
  return new Request("https://example.com/telegram", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [TELEGRAM_SECRET_HEADER]: providedSecret,
    },
    body: JSON.stringify(update),
  });
}

describe("processTelegramWebhookRequest", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(sendReplyToMessage).mockResolvedValue(true);
    vi.mocked(enforceSummaryRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(loadServiceStatusSnapshot).mockResolvedValue(
      makeStatusSnapshot(),
    );
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: true,
      summary: "<b>summary</b>",
    });
  });

  it("returns 401 for invalid webhook secret", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/summary");

    const response = await processTelegramWebhookRequest(
      makeRequest(update, "wrong-secret"),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(401);
    expect(sendReplyToMessage).not.toHaveBeenCalled();
  });

  it("summarizes and replies in an allowlisted group", async () => {
    const chatId = -1001;
    const fromUserId = 42;
    const nowSeconds = 10_000;
    const fromHours = 3;
    const toHours = 1;
    const chatUsername = "allowed_group";
    const commandText = `/summary ${fromHours}h ${toHours}h`;

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([chatId]));
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();
    const update = makeCommandUpdate(commandText, {
      chatId,
      chatType: "supergroup",
      chatUsername,
      date: nowSeconds,
      fromUserId,
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
      waitUntil,
    );

    expect(response.status).toBe(200);
    expect(enforceSummaryRateLimit).toHaveBeenCalledWith(
      env,
      chatId,
      fromUserId,
      nowSeconds,
    );
    expect(runTrackedSummarizeWindow).toHaveBeenCalledWith(env, {
      chatId,
      chatUsername,
      windowStart: nowSeconds - fromHours * 60 * 60,
      windowEnd: nowSeconds - toHours * 60 * 60,
      command: { type: "summary", fromHours, toHours },
      summaryRunContext: {
        source: SUMMARY_RUN_SOURCE_REAL_USAGE,
        runType: SUMMARY_RUN_TYPE_ON_DEMAND,
        waitUntil,
      },
    });
    expect(sendReplyToMessage).toHaveBeenCalledWith(
      "bot-token",
      update.message,
      "<b>summary</b>",
    );
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it("replies with blocked text for summary command from non-allowlisted group", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>());
    const update = makeCommandUpdate("/summary", {
      chatId: -2002,
      chatType: "supergroup",
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(sendReplyToMessage).toHaveBeenCalledWith(
      "bot-token",
      update.message,
      expect.any(String),
    );
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain("Current chat ID: <code>-2002</code>");
    expect(replyText).toContain(PROJECT_REPO_URL);
  });

  it("replies with parse guidance for invalid summary arguments in allowlisted group", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/summary not-a-number", {
      chatId: -1001,
      chatType: "supergroup",
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain("Usage: /summary");
  });

  it("replies with rate-limit text and skips summary generation when limited", async () => {
    vi.mocked(enforceSummaryRateLimit).mockResolvedValue({
      allowed: false,
      scope: "chat",
      limit: 20,
      windowSeconds: 600,
      retryAfterSeconds: 120,
    });

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/summary", {
      chatId: -1001,
      chatType: "supergroup",
      date: 10_000,
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain("Rate limit exceeded for this chat.");
    expect(replyText).toContain("Try again in 2m.");
  });

  it("replies with degraded message when summary backend is temporarily degraded", async () => {
    vi.mocked(runTrackedSummarizeWindow).mockResolvedValue({
      ok: false,
      reason: "degraded",
    });

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/summary", {
      chatId: -1001,
      chatType: "supergroup",
      date: 10_000,
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain(
      "Summary generation is temporarily unavailable due to recent AI failures.",
    );
  });

  it("ignores unknown commands without replying", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/doesnotexist", {
      chatId: -1001,
      chatType: "supergroup",
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(sendReplyToMessage).not.toHaveBeenCalled();
    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it("replies to /help in private chat", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>());
    const update = makeCommandUpdate("/help", {
      chatId: 777,
      chatType: "private",
      date: 2_000,
      fromUserId: 7,
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain("<b>Commands</b>");
    expect(replyText).toContain(`Project: ${PROJECT_REPO_URL}`);
  });

  it("ignores /help in group chats", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/help", {
      chatId: -1001,
      chatType: "supergroup",
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(sendReplyToMessage).not.toHaveBeenCalled();
    expect(runTrackedSummarizeWindow).not.toHaveBeenCalled();
    expect(insertMessage).not.toHaveBeenCalled();
  });

  it("replies to /status with split real and synthetic telemetry", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/status", {
      chatId: -1001,
      chatType: "supergroup",
      date: 2_500,
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(loadServiceStatusSnapshot).toHaveBeenCalledWith(env);
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain("<b>Real usage</b>");
    expect(replyText).toContain("<b>Synthetic benchmark</b>");
  });

  it("ingests non-command messages from allowlisted group chats", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeTextUpdate("hello team", {
      chatId: -1001,
      chatType: "group",
      chatUsername: "allowed_group",
      messageId: 44,
      date: 22_000,
      fromUserId: 88,
      fromUsername: "bob",
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(insertMessage).toHaveBeenCalledWith(env, {
      chatId: -1001,
      chatUsername: "allowed_group",
      messageId: 44,
      userId: 88,
      username: "bob",
      text: "hello team",
      ts: 22_000,
      replyToMessageId: null,
    });
    expect(sendReplyToMessage).not.toHaveBeenCalled();
  });

  it("ignores non-command messages from non-allowlisted group chats", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>());
    const update = makeTextUpdate("hello team", {
      chatId: -1001,
      chatType: "group",
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(200);
    expect(insertMessage).not.toHaveBeenCalled();
    expect(sendReplyToMessage).not.toHaveBeenCalled();
  });
});
