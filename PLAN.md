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
- Summaries cluster messages by topic, then for each topic cluster output SVO entries:
  - Subject: clickable user link
  - Verb: a verb like "says", "adds", "agrees", "disagrees", etc, as a clickable message link
  - Object: a short summary of what they said
- Expose service status/usage stats (uptime, error counts, DB usage where possible).
- Run on Cloudflare Workers + D1 + Workers AI free tiers.

## Non-Goals

- Eavesdropping on groups without adding the bot (not possible via Telegram APIs).
- Semantic search or "similar discussions" (no embeddings for now).
- Per-group configuration, retention policies, or user-specific preferences (future).
- Full analytics dashboards (future).

## Assumptions & Constraints

- Bot is added to groups and set as admin; privacy mode disabled.
- No data retention limit for now (messages stored indefinitely).
- Free-tier limits must be respected: Workers, D1, Workers AI.
- Daily summary time is fixed at 17:00 JST for now. Maybe in the future we can add a per group setting command.

## Proposed Design (Components + Data Flow)

- Cloudflare Worker HTTP endpoint receives Telegram webhook updates.
- Worker parses updates:
  - If message event: store in D1.
  - If command: fetch messages in requested window, summarize via Workers AI, reply.
- Cloudflare Cron Trigger runs daily at 08:00 UTC:
  - For each group with recent activity, summarize last 24h and post to group.
- Workers AI: use `@cf/ibm-granite/granite-4.0-h-micro` with chat-style `messages` to do topic clustering and reply formatting by prompt engineering.
- D1 stores:
  - messages: chat_id, chat_username, message_id, user_id, username, text, ts, reply_to.
  - summaries: chat_id, window_start, window_end, summary_text, ts.
  - service_stats: last_ok_ts, error_count, last_error, uptime_start.

## Interfaces / APIs

- Telegram webhook: POST /telegram (set via setWebhook).
- Commands:
  - /summary [Nh [Mh]] (N defaults to 1 and 0 is treated as 1; M defaults to 0; N, M = 0..168, N > M; 'h' is optional)
  - /summaryday (alias of /summary 24h)
  - /status
- Summary format (for one topic cluster):
  - topic, then SVO (Subject-Verb-Object) format. Subject is clickable user link. Verb is a verb like "says", "adds", "agrees", "disagrees", etc, with clickable message link. Object is a summary about what they said.
  - For example (Telegram HTML, TSX-style placeholders):

    ```tsx
    <b>{topic}</b>: {userLink1} {messageLink1} {obj1}; {userLink2} {messageLink2} {obj2}; {userLink3} {messageLink3} {obj3}.
    ```

  - User link format for users:

    ```tsx
    // With username:
    <a href={`https://t.me/${username}`}>@{username}</a>

    // Without username:
    <a href={`tg://user?id=${userId}`}>user:{userId}</a>
    ```

  - Message link format:

    ```tsx
    // Chat with chat username:
    <a href={`https://t.me/${chatUsername}/${messageId}`}>says/adds/agrees/etc</a>

    // Chat without chat username:
    <a href={`https://t.me/c/${internalChatId}/${messageId}`}>says/adds/agrees/etc</a>

    // Derive internalChatId from the Bot API chatId using Telegram's documented ID conversions:
    // - Supergroup/channel dialog ids are in the -100... range:
    //   internalChatId = -chatId - 1_000_000_000_000
    // - (Basic) group chat dialog ids are negative but not in the -100... range:
    //   internalChatId = -chatId
    const internalChatId =
      chatId <= -1_000_000_000_000 ? -chatId - 1_000_000_000_000 : -chatId;
    ```

## Step Plan (Commit-Sized)

### Checklist

- [x] docs: add plan
- [x] chore: project scaffold (wrangler, tsconfig, package.json, src entry)
- [x] chore: D1 bindings + schema (messages, summaries, service_stats)
- [x] feat: telegram webhook handler + signature verification
- [x] feat: message ingest + D1 insert
- [x] feat: command parsing + window parsing
- [x] feat: summary command (stub response)
- [ ] feat: workers-ai summarization (shared pipeline) (without format instruction prompt engineering)
- [ ] feat: prompt engineer the summary formatting with topic + participants with link + short summarization + message links
- [ ] feat: cron trigger + daily summary dispatch
- [ ] feat: status/usage command
- [ ] feat: error tracking + alerting

## Implementation Notes

- Secrets/env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `WORKERS_AI_*`, `D1_DATABASE_*`.
- Summary windows are hour-based: `/summary [Nh [Mh]]` uses the range from N hours before to M hours before, defaulting to 1h→0h.
- Telegram replies use `parse_mode: HTML` (avoid Markdown escaping / LLM confusion).
- When setting the Telegram webhook, set `allowed_updates` to only the update types we handle (currently `message`, `edited_message`) to reduce noise.
- Register bot commands (BotFather or `setMyCommands`) for `/summary`, `/summaryday`, `/status` so they show in the UI.

## Test / Validation Plan

- Local dev: wrangler dev and webhook test with curl or Telegram test updates.
- Manual tests:
  - Post messages in a group and verify D1 inserts.
  - /summary, /summary 3h and /summaryday produce a response.
  - /summary 4h 1h returns a range summary.
  - Daily cron simulated (triggered manually) posts summary.
  - /status returns uptime + error counts.

## Risks & Open Questions

- Workers AI free tier usage (10,000 neurons/day) may limit summary frequency.
- D1 write limits (100k/day) might be hit in large, high-volume groups.
- Message link access depends on group privacy and user membership.
- Telegram privacy mode and admin privileges must be correctly configured.
- Summaries depend on message volume and LLM response quality.
