import { beforeEach, describe, expect, it, vi } from "vitest";
import { markServiceOk, recordServiceError } from "../db/serviceStats.js";
import type { Env } from "../env.js";
import { runTrackedResponse, runTrackedTask } from "./serviceTracking.js";

vi.mock("../db/serviceStats.js", () => ({
  markServiceOk: vi.fn(),
  recordServiceError: vi.fn(),
}));

function makeEnv(): Env {
  return {
    DB: {} as D1Database,
    AI: {} as Ai,
    TELEGRAM_WEBHOOK_SECRET: "secret",
    TELEGRAM_BOT_TOKEN: "token",
    TELEGRAM_ALLOWED_CHAT_IDS: "",
    PROJECT_REPO_URL: "https://example.com/repo",
  };
}

describe("serviceTracking", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(markServiceOk).mockResolvedValue();
    vi.mocked(recordServiceError).mockResolvedValue();
  });

  it("schedules markServiceOk with waitUntil for tracked responses", async () => {
    const env = makeEnv();
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();

    vi.mocked(markServiceOk).mockReturnValue(
      new Promise<void>(() => undefined),
    );

    const response = await runTrackedResponse(
      env,
      "webhook",
      async () => await Promise.resolve(new Response("ok", { status: 200 })),
      waitUntil,
    );

    expect(response.status).toBe(200);
    expect(markServiceOk).toHaveBeenCalledWith(env);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });

  it("schedules recordServiceError with waitUntil for tracked tasks", async () => {
    const env = makeEnv();
    const waitUntil = vi.fn<(promise: Promise<void>) => void>();

    vi.mocked(recordServiceError).mockReturnValue(
      new Promise<void>(() => undefined),
    );

    await expect(
      runTrackedTask(
        env,
        "cron.daily_summary",
        async () => {
          await Promise.resolve();
          throw new Error("boom");
        },
        waitUntil,
      ),
    ).resolves.toBeUndefined();

    expect(recordServiceError).toHaveBeenCalledTimes(1);
    expect(waitUntil).toHaveBeenCalledTimes(1);
  });
});
