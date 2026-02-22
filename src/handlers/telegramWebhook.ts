import {
  requireTelegramRuntime,
  requireWebhookSecret,
} from "../app/runtime/telegramRuntime.js";
import { processTelegramWebhookRequest } from "../app/webhook/processTelegramWebhookRequest.js";
import type { Env } from "../env.js";
import { runTrackedResponse } from "../observability/serviceTracking.js";

export async function handleTelegramWebhook(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return await runTrackedResponse(
    env,
    "webhook",
    async () => {
      if (request.method !== "POST") {
        return new Response("method not allowed", { status: 405 });
      }

      const runtime = requireTelegramRuntime(env);
      const webhookSecret = requireWebhookSecret(env);
      return await processTelegramWebhookRequest(
        request,
        env,
        runtime,
        webhookSecret,
      );
    },
    ctx.waitUntil.bind(ctx),
  );
}
