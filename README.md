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
   ```

3. Run local worker:

   ```bash
   pnpm dev
   ```

## Deploy

1. Deploy worker:

   ```bash
   pnpm deploy
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

## Scripts

- `pnpm dev`: local worker with test-scheduled support.
- `pnpm deploy`: deploy worker.
- `pnpm cf-typegen`: regenerate Cloudflare types.
- `pnpm run telegram:setup`: call Telegram `setWebhook` + `setMyCommands`.

## Rate Limiting

- Applies to `/summary` and `/summaryday` only.
- Uses fixed 10-minute windows.
- Default limits:
  - Per-user-in-chat: 3 requests per 10 minutes.
  - Per-chat: 20 requests per 10 minutes.
- Tuning values live in `src/config.ts`.

## Docs

- Operational runbook: `docs/ops.md`
- Project plan and progress: `PLAN.md`

## License

Licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See
`LICENSE`.

## Copyright

Copyright (C) 2026 Escape0707. See `COPYRIGHT`.
