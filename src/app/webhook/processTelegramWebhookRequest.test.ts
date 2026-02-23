import { beforeEach, describe, expect, it, vi } from "vitest";
import { TELEGRAM_SECRET_HEADER } from "../../config.js";
import type { Env } from "../../env.js";
import { insertMessage } from "../../db/messages.js";
import { enforceSummaryRateLimit } from "../../db/rateLimits.js";
import { loadServiceStatusSnapshot } from "../../db/serviceStats.js";
import type { TelegramRuntime } from "../runtime/telegramRuntime.js";
import { enqueueSummaryJob } from "../../queue/summaryQueueProducer.js";
import type { SummaryQueueMessage } from "../../queue/summaryJobs.js";
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

vi.mock("../../queue/summaryQueueProducer.js", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("../../queue/summaryQueueProducer.js")
    >();

  return {
    ...actual,
    enqueueSummaryJob: vi.fn(),
  };
});

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
  forwardOrigin?: TelegramMessage["forward_origin"];
  isAutomaticForward?: boolean;
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
    SUMMARY_QUEUE: {} as Queue<SummaryQueueMessage>,
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
    ...(options.forwardOrigin
      ? {
          forward_origin: options.forwardOrigin,
        }
      : {}),
    ...(options.isAutomaticForward ? { is_automatic_forward: true } : {}),
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
    vi.mocked(enqueueSummaryJob).mockResolvedValue();
    vi.mocked(enforceSummaryRateLimit).mockResolvedValue({ allowed: true });
    vi.mocked(loadServiceStatusSnapshot).mockResolvedValue(
      makeStatusSnapshot(),
    );
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

  it("enqueues summary command in an allowlisted group and does not reply immediately", async () => {
    const chatId = -1001;
    const fromUserId = 42;
    const nowSeconds = 10_000;
    const fromHours = 3;
    const toHours = 1;
    const chatUsername = "allowed_group";
    const commandText = `/summary ${fromHours}h ${toHours}h`;

    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([chatId]));
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
    );

    expect(response.status).toBe(200);
    expect(enforceSummaryRateLimit).toHaveBeenCalledWith(
      env,
      chatId,
      fromUserId,
      nowSeconds,
    );
    expect(enqueueSummaryJob).toHaveBeenCalledWith(env.SUMMARY_QUEUE, {
      type: "on_demand",
      jobId: `on_demand:${chatId}:${update.message.message_id}`,
      chatId,
      chatUsername,
      command: { type: "summary", fromHours, toHours },
      requestedAtTs: nowSeconds,
      requesterUserId: fromUserId,
      replyToMessageId: update.message.message_id,
    });
    expect(sendReplyToMessage).not.toHaveBeenCalled();
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
    expect(enqueueSummaryJob).not.toHaveBeenCalled();
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
    expect(enqueueSummaryJob).not.toHaveBeenCalled();
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain("Usage: /summary");
  });

  it("replies with rate-limit text and skips summary enqueue when limited", async () => {
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
    expect(enqueueSummaryJob).not.toHaveBeenCalled();
    const replyText = vi.mocked(sendReplyToMessage).mock.calls[0]?.[2];
    expect(replyText).toContain("Rate limit exceeded for this chat.");
    expect(replyText).toContain("Try again in 2m.");
  });

  it("returns 500 when summary job enqueue fails", async () => {
    vi.mocked(enqueueSummaryJob).mockRejectedValue(new Error("queue down"));
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

    expect(response.status).toBe(500);
    expect(sendReplyToMessage).not.toHaveBeenCalled();
  });

  it("returns 500 when SUMMARY_QUEUE binding is missing", async () => {
    const env = makeEnv();
    delete env.SUMMARY_QUEUE;
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeCommandUpdate("/summary", {
      chatId: -1001,
      chatType: "supergroup",
    });

    const response = await processTelegramWebhookRequest(
      makeRequest(update),
      env,
      runtime,
      WEBHOOK_SECRET,
    );

    expect(response.status).toBe(500);
    expect(enqueueSummaryJob).not.toHaveBeenCalled();
    expect(sendReplyToMessage).not.toHaveBeenCalled();
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
    expect(enqueueSummaryJob).not.toHaveBeenCalled();
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
    expect(enqueueSummaryJob).not.toHaveBeenCalled();
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

  it("attributes forwarded user-origin messages to original sender", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeTextUpdate("fwd text", {
      chatId: -1001,
      chatType: "group",
      chatUsername: "allowed_group",
      messageId: 45,
      date: 22_100,
      fromUserId: 88,
      fromUsername: "forwarder",
      forwardOrigin: {
        type: "user",
        date: 22_000,
        sender_user: {
          id: 99,
          username: "original_sender",
        },
      },
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
      messageId: 45,
      userId: 99,
      username: "original_sender",
      text: "fwd text",
      ts: 22_100,
      replyToMessageId: null,
    });
  });

  it("keeps forwarder attribution for non-user forward origins", async () => {
    const env = makeEnv();
    const runtime = makeRuntime(new Set<number>([-1001]));
    const update = makeTextUpdate("fwd channel post", {
      chatId: -1001,
      chatType: "group",
      messageId: 46,
      date: 22_200,
      fromUserId: 88,
      fromUsername: "forwarder",
      isAutomaticForward: true,
      forwardOrigin: {
        type: "channel",
        date: 22_050,
        chat: {
          id: -1002,
          type: "channel",
          username: "source_channel",
        },
        message_id: 777,
      },
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
      chatUsername: null,
      messageId: 46,
      userId: 88,
      username: "forwarder",
      text: "fwd channel post",
      ts: 22_200,
      replyToMessageId: null,
    });
  });
});
