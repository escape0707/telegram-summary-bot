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
   pnpm deploy
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

3. In DM, run `/start` and confirm onboarding/self-host guidance is shown.

4. Tail logs:

   ```bash
   pnpm wrangler tail --format pretty
   ```

## Cron Checks

- Current schedule is defined in `wrangler.jsonc`.
- Verify cron runs in tail logs:
  - `Daily summary cron started`
  - `Daily summary cron finished`

For short-interval testing, temporarily change cron schedule, deploy, verify,
then revert.

## Runtime Structure

- `src/handlers/telegramWebhook.ts`:
  thin tracked adapter for webhook requests.
- `src/app/webhook/processTelegramWebhookRequest.ts`:
  webhook business flow (auth check, update parsing, command handling, ingest).
- `src/handlers/dailySummaryCron.ts`:
  thin tracked adapter for scheduled events.
- `src/app/cron/runDailySummary.ts`:
  cron business flow (chat scan, summary generation, delivery, reporting).
- `src/app/summary/summarizeWindow.ts`:
  shared "load messages + summarize window" pipeline reused by command and cron.
- `src/telegram/replies.ts` and `src/telegram/texts.ts`:
  reusable Telegram send helpers and user-facing text builders.
- `src/observability/serviceTracking.ts` and `src/errors/appError.ts`:
  tracked operation wrappers and typed application error codes.

## Webhook Ack Policy

- `2xx` means "update accepted" and Telegram should not retry this update.
- non-`2xx` means "delivery failed" and Telegram may retry.
- Current behavior:
  - Returns `200` for successfully handled updates and intentionally ignored
    updates (for example unknown commands).
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

## Recovery

1. Re-run webhook/command setup script.
2. Re-deploy latest known good commit.
3. Check `/status` and tail logs for `last_error` context.
