import { processTelegramWebhookRequest } from "../app/webhook/processTelegramWebhookRequest.js";
import type { Env } from "../env.js";
import { runTrackedResponse } from "../observability/serviceTracking.js";

export async function handleTelegramWebhook(
  request: Request,
  env: Env
): Promise<Response> {
  return runTrackedResponse(env, "webhook", () =>
    processTelegramWebhookRequest(request, env)
  );
}
