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

## Verify After Deploy

1. Health endpoint:

   ```bash
   curl -i https://<worker-domain>/health
   ```

2. In Telegram group:

   - Send regular messages.
   - Run `/summary`.
   - Run `/summaryday`.
   - Run `/status`.

3. Tail logs:

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

## Recovery

1. Re-run webhook/command setup script.
2. Re-deploy latest known good commit.
3. Check `/status` and tail logs for `last_error` context.
