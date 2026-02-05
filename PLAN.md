# PLAN

## Problem / Motivation
Build a Telegram group-summary bot and ship a usable product.
The bot logs group messages, generates LLM summaries, posts daily summaries at 17:00 JST,
and exposes status/usage commands. It must run on Cloudflare free tier with minimal
ongoing cost and operational burden.

## Goals
- Ingest and store Telegram group messages (timestamp, author, text, message link).
- Provide on-demand summaries for last 1h, last 24h, and custom time windows.
- Post daily summary at 17:00 JST (08:00 UTC) to each group the bot is in.
- Summaries include participants and a link to at least one message per topic.
- Expose service status/usage stats (uptime, error counts, DB usage where possible).
- Run on Cloudflare Workers + D1 + Workers AI free tiers.

## Non-Goals
- Eavesdropping on groups without adding the bot (not possible via Telegram APIs).
- Semantic search or "similar discussions" (no embeddings for now).
- Per-group configuration, retention policies, or user-specific preferences (future).
- Full analytics dashboards (future).

## Assumptions & Constraints
- Bot is added to groups and set as admin; privacy mode can be disabled as needed.
- Target groups are public (have usernames) for message link generation.
- No data retention limit for now (messages stored indefinitely).
- Free-tier limits must be respected: Workers, D1, Workers AI.
- Daily summary time is fixed at 17:00 JST.

## Proposed Design (Components + Data Flow)
- Cloudflare Worker HTTP endpoint receives Telegram webhook updates.
- Worker parses updates:
  - If message event: store in D1.
  - If command: fetch messages in requested window, summarize via Workers AI, reply.
- Cloudflare Cron Trigger runs daily at 08:00 UTC:
  - For each group with recent activity, summarize last 24h and post to group.
- Workers AI: summarization prompt produces list items with participants + message links.
- D1 stores:
  - messages: chat_id, chat_username, message_id, user_id, username, text, ts, reply_to.
  - summaries: chat_id, window_start, window_end, summary_text, ts.
  - service_stats: last_ok_ts, error_count, last_error, uptime_start.

## Interfaces / APIs
- Telegram webhook: POST /telegram (set via setWebhook).
- Commands:
  - /summary_1h
  - /summary_24h
  - /summary from:YYYY-MM-DDTHH:MM to:YYYY-MM-DDTHH:MM (UTC or with TZ)
  - /status
  - /stats (alias of /status, optional)
- Summary format (example):
  - "@user1, @user2 discussed [topic](https://t.me/<group>/<message_id>) about XXXXX"
- Message link format for public groups:
  - https://t.me/<group_username>/<message_id>

## Step Plan (Commit-Sized)
### Checklist
- [x] docs: add plan
- [x] chore: project scaffold (wrangler, tsconfig, package.json, src entry)
- [x] chore: D1 bindings + schema (messages, summaries, service_stats)
- [x] feat: telegram webhook handler + signature verification
- [ ] feat: message ingest + D1 insert
- [ ] feat: command parsing + window parsing
- [ ] feat: summary_1h + summary_24h (stub response)
- [ ] feat: workers-ai summarization (shared pipeline)
- [ ] feat: summary formatting with participants + message links
- [ ] feat: cron trigger + daily summary dispatch
- [ ] feat: status/usage command
- [ ] feat: error tracking + alerting

## Implementation Notes
- Secrets/env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WORKERS_AI_*`, `D1_DATABASE_*`.
- Time windows default to UTC; allow explicit TZ in `/summary from:... to:...`.

## Test / Validation Plan
- Local dev: wrangler dev and webhook test with curl or Telegram test updates.
- Manual tests:
  - Post messages in a group and verify D1 inserts.
  - /summary_1h and /summary_24h produce a response.
  - Daily cron simulated (triggered manually) posts summary.
  - /status returns uptime + error counts.

## Risks & Open Questions
- Workers AI free tier usage (10,000 neurons/day) may limit summary frequency.
- D1 write limits (100k/day) might be hit in large, high-volume groups.
- Message link access depends on group privacy and user membership.
- Telegram privacy mode and admin privileges must be correctly configured.
- Summaries depend on message volume and LLM response quality.
