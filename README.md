# Telegram Summary Bot

A Cloudflare Worker bot that ingests Telegram group messages and produces
on-demand and daily AI summaries.

## Features

- Store non-command group messages in D1.
- `/summary [Nh [Mh]]` for custom window summaries.
- `/summaryday` alias for last 24h.
- `/status` for service snapshot and counters.
- Daily cron summary dispatch (08:00 UTC / 17:00 JST).
- Summary command rate limiting (per-user-in-chat and per-chat fixed windows).
- GitHub Actions CI (typecheck) and manual CD workflow.

## Architecture

- Ingress: Telegram sends updates to Worker webhook (`/telegram`), which
  validates secret headers, parses commands, and ingests group messages.
- Storage: D1 stores raw messages, summaries, service stats, and rate-limit
  counters.
- Summarization: shared application pipeline loads windowed messages and calls
  Workers AI for clustered summaries.
- Scheduling: Cloudflare Cron triggers daily summary dispatch at 08:00 UTC.
- Ops: tracked wrappers persist success/error state for `/status` and incident
  debugging.

## Tradeoffs

- Strong simplicity and low cost over advanced configurability.
- Self-host/operator model over shared multi-tenant service.
- Fixed-window rate limiting over more complex token-bucket or adaptive models.
- Prompt-driven formatting over deterministic template-only summarization.

## Self-Hosting Model

- This project is designed for self-hosting, not as a shared public SaaS bot.
- Each operator should deploy and manage their own Worker instance.
- The operator is expected to understand basic Telegram Bot + Cloudflare Worker
  operations and to actively participate in chats where the bot is installed.
- This deployment can restrict usage with `TELEGRAM_ALLOWED_CHAT_IDS`.

## Stack

- Cloudflare Workers
- Cloudflare D1
- Cloudflare Workers AI
- Telegram Bot API
- TypeScript + pnpm

## Prerequisites

- Node.js 22+
- pnpm
- Cloudflare account and `wrangler` access
- Telegram bot token from BotFather

## Local Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Configure local env vars in `.dev.vars` (example):

   ```bash
   TELEGRAM_BOT_TOKEN=...
   TELEGRAM_WEBHOOK_SECRET=...
   TELEGRAM_ALLOWED_CHAT_IDS=-1001234567890
   PROJECT_REPO_URL=https://github.com/escape0707/telegram-summary-bot
   ```

3. Run local worker:

   ```bash
   pnpm dev
   ```

## Deploy

1. Deploy worker:

   ```bash
   pnpm run deploy
   ```

2. Configure webhook and bot commands:

   ```bash
   TELEGRAM_BOT_TOKEN='<bot_token>' \
   TELEGRAM_WEBHOOK_URL='https://<your-worker-domain>/telegram' \
   TELEGRAM_WEBHOOK_SECRET='<webhook_secret>' \
   pnpm run telegram:setup
   ```

Optional:

- `TELEGRAM_ALLOWED_UPDATES='message,edited_message'`
- `TELEGRAM_DROP_PENDING_UPDATES='true'`

## Allowlist and Onboarding

- `TELEGRAM_ALLOWED_CHAT_IDS` controls which chat IDs can use this deployment.
- Format: comma-separated numeric IDs, for example:
  `-1001234567890,-1009876543210`.
- Recommended production setup:

  ```bash
  wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS
  ```

- Non-allowlisted chat commands receive a self-host guidance reply with the
  current `chat.id`, so users can self-host their own instance without log
  inspection.
- `/help` and `/start` provide onboarding guidance in DMs only.
- In groups, `/help` and `/start` are intentionally ignored to reduce noise.

## Scripts

- `pnpm dev`: local worker with test-scheduled support.
- `pnpm run deploy`: deploy worker.
- `pnpm run format`: format files with Prettier.
- `pnpm run format:check`: check formatting in CI/local.
- `pnpm run lint`: run ESLint.
- `pnpm run lint:fix`: run ESLint autofixes.
- `pnpm run lint:md`: lint Markdown docs.
- `pnpm cf-typegen`: regenerate Cloudflare types.
- `pnpm run telegram:setup`: call Telegram `setWebhook` + `setMyCommands`.

## Rate Limiting

- Applies to `/summary` and `/summaryday` only.
- Uses fixed 10-minute windows.
- Default limits:
  - Per-user-in-chat: 3 requests per 10 minutes.
  - Per-chat: 20 requests per 10 minutes.
- Stale rate-limit rows are cleaned by daily cron in bounded batches.
- Cleanup defaults:
  - Retention: 3 days (`RATE_LIMIT_CLEANUP_RETENTION_SECONDS`).
  - Batch size: 500 rows (`RATE_LIMIT_CLEANUP_BATCH_SIZE`).
  - Max batches per cron run: 20 (`RATE_LIMIT_CLEANUP_MAX_BATCHES`).
- Tuning values live in `src/config.ts`.

## Docs

- Operational runbook: `docs/ops.md`
- Project plan and progress: `PLAN.md`

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See
`LICENSE`.

## Copyright

Copyright (C) 2026 Escape0707. See `COPYRIGHT`.
