# Architecture and Structure Review

Date: 2026-02-17

## Findings (ordered by severity)

1. High: Webhook processing is synchronous through AI + Telegram send,
   which risks timeout/retry amplification.
   - `src/app/webhook/processTelegramWebhookRequest.ts:59`
   - `src/app/webhook/processTelegramWebhookRequest.ts:112`
   - `src/ai/summary.ts:146`
   - `src/telegram/api.ts:35`
   - Note: expensive work happens before webhook ack, so retries can
     duplicate command replies under latency spikes.

2. High: No idempotency guard for command updates.
   - `src/app/webhook/processTelegramWebhookRequest.ts:52`
   - `migrations/0001_init.sql:11`
   - Note: non-command ingest is deduped by `(chat_id, message_id)`,
     but command-side effects are not deduped by `update_id`.

3. High: Service tracking writes to D1 on nearly every request and can
   mark unhealthy traffic as "OK".
   - `src/observability/serviceTracking.ts:58`
   - `src/observability/serviceTracking.ts:66`
   - `src/db/serviceStats.ts:39`
   - Note: any `<500` response updates `last_ok_ts`, including auth/shape errors.

4. High: Sensitive chat content is logged verbosely.
   - `src/ai/summary.ts:141`
   - `src/ai/summary.ts:161`
   - Note: raw prompt input and raw summary output are written to logs.

5. Medium: `summaries` table exists but is not used, so status metric is misleading.
   - `migrations/0001_init.sql:16`
   - `src/db/serviceStats.ts:76`
   - Note: `/status` reports stored summaries, but no summary insert path exists.

6. Medium: Cron dispatch is strictly sequential and failures are
   swallowed at task-wrapper layer.
   - `src/app/cron/runDailySummary.ts:65`
   - `src/observability/serviceTracking.ts:85`
   - `src/index.ts:23`
   - Note: this can become a throughput bottleneck and reduce
     platform-level failure signaling.

7. Medium: `/status` performs full-table counts on demand.
   - `src/db/serviceStats.ts:74`
   - Note: `COUNT(*)` over growing `messages` can impact latency/cost.

8. Medium: Automated test coverage for core behavior is missing.
   - `.github/workflows/ci.yml:31`
   - `PLAN.md:115`
   - Note: CI typechecks only; behavior-level guarantees are not covered.

## Strengths

- Clean layering with thin adapters in `src/handlers` and orchestration in `src/app`.
- Good module separation for infra concerns (`src/db`, `src/telegram`,
  `src/ai`, `src/observability`).
- Strict TypeScript config improves maintainability and change safety.
