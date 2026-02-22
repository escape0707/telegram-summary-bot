import { runDailySummary } from "../app/cron/runDailySummary.js";
import { requireTelegramRuntime } from "../app/runtime/telegramRuntime.js";
import type { Env } from "../env.js";
import { runTrackedTask } from "../observability/serviceTracking.js";

export async function handleDailySummaryCron(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
): Promise<void> {
  await runTrackedTask(
    env,
    "cron.daily_summary",
    async () => {
      const runtime = requireTelegramRuntime(env);
      await runDailySummary(controller, env, runtime);
    },
    ctx.waitUntil.bind(ctx),
  );
}
