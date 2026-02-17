import { runDailySummary } from "../app/cron/runDailySummary.js";
import type { Env } from "../env.js";
import { runTrackedTask } from "../observability/serviceTracking.js";

export async function handleDailySummaryCron(
  controller: ScheduledController,
  env: Env
): Promise<void> {
  return runTrackedTask(env, "cron.daily_summary", () =>
    runDailySummary(controller, env)
  );
}
