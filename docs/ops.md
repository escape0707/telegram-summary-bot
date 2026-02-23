# Ops Runbook

## Purpose

This runbook covers setup, deploy, verification, and basic recovery for
`telegram-summary-bot`.

## Required Secrets

- Cloudflare:
  - `CLOUDFLARE_API_TOKEN`
  - `CLOUDFLARE_ACCOUNT_ID`
- Worker runtime:
  - `TELEGRAM_BOT_TOKEN`
  - `TELEGRAM_WEBHOOK_SECRET`
  - `TELEGRAM_ALLOWED_CHAT_IDS`

## Self-Host Responsibility

- This bot is intended to be self-hosted per operator/team, not used as a
  shared public endpoint.
- The deployment owner is responsible for bot setup, allowlist management,
  moderation expectations, and runtime cost/risk boundaries.
- If a random user DMs `/start`, the bot returns onboarding/self-host guidance.
- `/help` and `/start` are DM-only and ignored in group chats.
- Non-allowlisted group usage of summary/status commands returns self-host
  guidance instead of granting access.

## Deploy Workflow

1. Deploy from local:

   ```bash
   pnpm run deploy
   ```

   Or trigger manual deploy in GitHub Actions (`Deploy` workflow).

2. Configure webhook and commands:

   ```bash
   TELEGRAM_BOT_TOKEN='<bot_token>' \
   TELEGRAM_WEBHOOK_URL='https://<worker-domain>/telegram' \
   TELEGRAM_WEBHOOK_SECRET='<webhook_secret>' \
   pnpm run telegram:setup
   ```

3. Configure allowlisted chats for this deployment:

   ```bash
   wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS
   ```

   - Value format: comma-separated numeric chat IDs
     (example: `-1001234567890,-1009876543210`).
   - Optional: set `PROJECT_REPO_URL` so onboarding replies point to your fork
     or deployment docs.

## Verify After Deploy

1. Health endpoint:

   ```bash
   curl -i https://<worker-domain>/health
   ```

2. In an allowlisted Telegram group, send regular messages and run `/summary`,
   `/summaryday`, and `/status`.
   - `/summary` and `/summaryday` should return no immediate bot reply.
   - The actual summary reply should arrive asynchronously from queue consumer
     processing.

3. In DM, run `/start` and confirm onboarding/self-host guidance is shown.

4. Tail logs:

   ```bash
   pnpm wrangler tail --format pretty
   ```

5. Verify queue processing logs:
   - `Received summary queue batch`
   - For cron path, `Daily summary cron finished` includes `enqueuedCount`.

## Cron Checks

- Current schedule is defined in `wrangler.jsonc`.
- Verify cron runs in tail logs:
  - `Daily summary cron started`
  - `Daily summary cron finished`
  - `enqueuedCount` should reflect active allowlisted chats.

For short-interval testing, temporarily change cron schedule, deploy, verify,
then revert.

## Runtime Structure

- `src/handlers/telegramWebhook.ts`:
  thin tracked adapter for webhook requests.
- `src/app/webhook/processTelegramWebhookRequest.ts`:
  webhook business flow (auth check, update parsing, command handling, enqueue,
  ingest).
- `src/handlers/dailySummaryCron.ts`:
  thin tracked adapter for scheduled events.
- `src/app/cron/runDailySummary.ts`:
  cron business flow (chat scan, allowlist filter, summary job enqueue,
  reporting).
- `src/handlers/summaryQueue.ts`:
  queue adapter for consumer batches and runtime token guard.
- `src/app/queue/processSummaryQueueBatch.ts`:
  queue consumer business flow (claim, summarize, Telegram send/reply,
  retry/ack).
- `src/db/summaryQueueJobs.ts`:
  idempotency claim store for at-least-once queue delivery.
- `src/app/summary/summarizeWindow.ts`:
  shared "load messages + summarize window" pipeline reused by queue jobs.
- `src/telegram/send.ts` and `src/telegram/texts.ts`:
  reusable Telegram send helpers and user-facing text builders.
- `src/observability/serviceTracking.ts` and `src/errors/appError.ts`:
  tracked operation wrappers and typed application error codes.

## Queue Operation Model

- Queue binding:
  - Producer binding: `SUMMARY_QUEUE`.
  - Queue name: `summary-jobs`.
  - Consumer config in `wrangler.jsonc`:
    - `max_batch_size=1`
    - `max_batch_timeout=0`
- Producer responsibilities:
  - Webhook enqueues on-demand jobs for `/summary` and `/summaryday`.
  - Daily cron enqueues daily jobs per allowlisted active chat.
- Consumer responsibilities:
  - Performs summary generation and Telegram delivery.
  - Applies idempotency claim checks to avoid duplicate sends across retries.
  - Uses at-least-once-safe completion with ownership checks.

## Queue Failure Handling

- Producer-side failures:
  - Webhook enqueue failure returns `500` (`internal error`) so Telegram may
    retry update delivery.
  - Missing `SUMMARY_QUEUE` binding returns `500`.
  - Daily cron enqueue failure throws tracked `CronDispatchPartialFailure`.
- Consumer-side failures:
  - Missing or empty `TELEGRAM_BOT_TOKEN`: `retryAll` on the batch.
  - Claim read/write failure: retry message with default delay.
  - `in_flight` claim: retry with delay aligned to lease expiry.
  - Daily `ai_error`: retry with longer delay.
  - Daily `no_messages`, `no_text`, `degraded`: ack silently.
  - On-demand `no_messages`, `no_text`, `degraded`: send user-facing reply and
    ack.
  - Claim ownership lost during completion: warn and ack (prevents duplicate
    loops).
- DLQ:
  - Not configured in current queue v1 rollout.

## Summary Persistence Semantics

- Successful summaries from on-demand and daily cron paths are persisted to D1
  `summaries`.
- `/status` `Stored summaries` reflects persisted summary rows in `summaries`.
- This persistence is used for history/audit/troubleshooting and counters; it
  is not currently used as a broad cache for cross-window summary reuse.

## Forwarded Message Attribution Semantics

- Webhook ingest attributes regular messages to `message.from`.
- For forwarded messages, attribution switches to the original sender only when
  Telegram provides `forward_origin.type = user` with `sender_user`.
- For all other forwarded-origin types (`hidden_user`, `chat`, `channel`) and
  automatic forwards, attribution remains the forwarding user (`message.from`).

## Degraded Mode Semantics

- Summary generation enters temporary degraded mode when recent `ai_error`
  failures exceed the configured threshold.
- Defaults in `src/config.ts`:
  - `SUMMARY_AI_DEGRADED_WINDOW_SECONDS=900` (15 minutes)
  - `SUMMARY_AI_DEGRADED_FAILURE_THRESHOLD=5`
- During degraded mode:
  - `/summary` and `/summaryday` return a temporary-unavailable message.
  - Daily cron skips summary sending for affected windows/chats.
- Recovery is automatic once recent `ai_error` counts fall below threshold.

## Webhook Ack Policy

- `2xx` means "update accepted" and Telegram should not retry this update.
- non-`2xx` means "delivery failed" and Telegram may retry.
- Current behavior:
  - Returns `200` for successfully handled updates and intentionally ignored
    updates (for example unknown commands).
  - For `/summary` and `/summaryday`, `200` indicates "job enqueued" (or command
    path accepted), not "summary already delivered".
  - Returns `4xx` for method/auth/request-shape errors.
  - Returns `5xx` for internal processing failures (for example DB/send errors).

## Rate Limiting

- Scope:
  - `/summary`
  - `/summaryday`
- Excluded:
  - `/status`
- Default limits:
  - Per-user-in-chat: 3 requests / 10 minutes.
  - Per-chat: 20 requests / 10 minutes.
- Storage: D1 `rate_limits` table, fixed-window counters.
- Stale row cleanup:
  - Runs in daily cron as best effort.
  - Deletes stale rows in bounded batches to avoid long lock/write spikes.
- Cleanup defaults:
  - Retention: 3 days (`RATE_LIMIT_CLEANUP_RETENTION_SECONDS`).
  - Batch size: 500 (`RATE_LIMIT_CLEANUP_BATCH_SIZE`).
  - Max batches per run: 20 (`RATE_LIMIT_CLEANUP_MAX_BATCHES`).
- Tuning: update values in `src/config.ts`, deploy, then monitor logs.

## Synthetic Benchmark Workflow

1. Use a staging deployment or isolated local environment; do not benchmark in
   production chats.
2. Prepare synthetic/anonymized inputs only.
3. Run your benchmark harness so summary telemetry writes use
   `source = synthetic_benchmark` in `summary_runs`.
4. Verify `/status`:
   - `Real usage` remains production-only.
   - `Synthetic benchmark` reflects benchmark runs.
5. If benchmark rows should be removed after analysis, delete only
   `source='synthetic_benchmark'` rows from `summary_runs`.

Note: This repo does not currently include a dedicated synthetic benchmark CLI.
Use your own controlled harness/script and keep source labeling explicit.

## Privacy-Safe Demo Capture

- Demo from synthetic/anonymized datasets only.
- Show summary output and `/status` aggregates; avoid sharing raw message logs.
- Redact or crop chat identifiers, usernames, and message links in screenshots.
- Do not publish D1 exports containing user-generated content.

## Common Issues

1. `401 unauthorized` on webhook:
   `TELEGRAM_WEBHOOK_SECRET` mismatch between Worker and Telegram webhook setup.
2. `Bad Request: can't parse entities` from Telegram:
   AI output generated invalid HTML.
   The bot retries with unformatted text fallback for send failures in this
   case.
3. No messages stored:
   Bot privacy mode/admin config not correct.
   Group message type is unsupported.
4. `activeChats: 0` in cron logs:
   No non-command messages in the last 24 hours.
5. `Rate limit exceeded` responses for summary commands:
   Expected behavior under load.
   Consider tuning rate limits in `src/config.ts` if limits are too strict.
6. `Deleted stale rate limit rows` appears in cron logs:
   Expected periodic cleanup behavior.
7. `Summary generation is temporarily unavailable due to recent AI failures`:
   Degraded mode is active.
   Check recent `ai_error` logs and wait for the rolling window to recover.
8. `/summary` command accepted (`200`) but no summary arrives:
   Check queue consumer logs for:
   - `Received summary queue batch`
   - claim warnings/errors (`Failed to claim summary queue job`,
     `Summary queue job claim lost before completion`)
   - Telegram send/reply failures

## Recovery

1. Re-run webhook/command setup script.
2. Re-deploy latest known good commit.
3. Check `/status` and tail logs for `last_error` context.
