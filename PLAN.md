# PLAN

## Problem / Motivation

Build a Telegram group-summary bot: ingest group messages, generate LLM
summaries, post daily summaries at 17:00 JST (08:00 UTC), and expose
status/usage commands. It must run on Cloudflare free tiers with minimal
ongoing cost and operational burden.

## Goals

- Ingest and store non-command Telegram group messages (timestamp, author,
  text, and identifiers to build message/user links).
- Provide on-demand summaries for last 1h, last 24h, and custom time windows.
- Post daily summary at 17:00 JST (08:00 UTC) to each group the bot is in.
- Summaries cluster messages by topic, then output SVO entries per topic
  (Subject=user link; Verb=message link; Object=short summary).
- Expose service status/usage stats (uptime, error counts, DB usage where possible).
- Run on Cloudflare Workers + D1 + Workers AI free tiers.

## Non-Goals

- Eavesdropping on groups without adding the bot (not possible via Telegram APIs).
- Semantic search or "similar discussions" (no embeddings for now).
- Per-group configuration, retention policies, or user-specific preferences (future).
- Full analytics dashboards (future).

## Assumptions & Constraints

- Bot is added to groups and set as admin; privacy mode disabled.
- This project is self-hosted and operator-managed, not a public multi-tenant
  SaaS bot service.
- Operator is expected to have basic Telegram Bot + Cloudflare Workers
  knowledge and to actively participate in groups where the bot is installed.
- No data retention limit for now (messages stored indefinitely).
- Free-tier limits must be respected: Workers, D1, Workers AI.
- Daily summary time is fixed at 17:00 JST for now (future: per-group setting).

## Proposed Design (Components + Data Flow)

- Cloudflare Worker HTTP endpoint receives Telegram webhook updates.
  - Non-command message event: store in D1.
  - Command: fetch messages in requested window, summarize via Workers AI, reply.
- Cloudflare Cron Trigger runs daily at 08:00 UTC:
  - For each group with recent activity, summarize last 24h and post to group.
- Workers AI: use `@cf/mistralai/mistral-small-3.1-24b-instruct` with
  chat-style `messages` to do topic clustering and reply formatting by prompt
  engineering.
- D1 stores:
  - messages: chat_id, chat_username, message_id, user_id, username, text, ts, reply_to.
  - summaries: chat_id, window_start, window_end, summary_text, ts.
  - service_stats: last_ok_ts, error_count, last_error, uptime_start.

## Interfaces / APIs

- Telegram webhook: POST /telegram (set via setWebhook).
- Commands:
  - /summary [Nh [Mh]] (N defaults to 1, 0 treated as 1; M defaults to 0;
    N,M in 0..168; require N > M; optional 'h')
  - /summaryday (alias of /summary 24h)
  - /status
  - /help
  - /start
- Summary format (for one topic cluster):
  - Topic, then SVO (Subject-Verb-Object) entries: Subject is a clickable user
    link; Verb is clickable message link text (e.g.
    says/adds/agrees/disagrees); Object is a short summary.
  - Example (Telegram HTML, TSX-style placeholders):

    ```tsx
    <b>{topic}</b>: {userLink1} {messageLink1} {obj1}; {userLink2}
    {messageLink2} {obj2}; {userLink3} {messageLink3} {obj3}.
    ```

  - User link format for users:

    ```tsx
    const userLink = username ? (
      <a href={`https://t.me/${username}`}>@{username}</a>
    ) : (
      <a href={`tg://user?id=${userId}`}>user:{userId}</a>
    );
    ```

  - Message link format:

    ```tsx
    const internalChatId =
      chatId <= -1_000_000_000_000 ? -chatId - 1_000_000_000_000 : -chatId;

    const messageUrl = chatUsername
      ? `https://t.me/${chatUsername}/${messageId}`
      : `https://t.me/c/${internalChatId}/${messageId}`;

    const messageLink = <a href={messageUrl}>says/adds/agrees/etc</a>;
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
- [x] feat: workers-ai summarization (shared pipeline) (without format
      instruction prompt engineering)
- [x] feat: prompt engineer HTML SVO formatting (topic clusters + user/message links)
- [x] feat: status/usage command
- [x] feat: cron trigger + daily summary dispatch
- [x] feat: error tracking (alerting deferred)
- [x] chore: typed error codes for tracked operations

### Wrap-up Checklist

- [x] ci: add GitHub Actions quality workflow (pnpm install + tsc typecheck)
- [x] cd: add GitHub Actions deploy workflow (manual dispatch first)
- [x] chore: automate Telegram webhook + bot command registration
- [x] docs: add project docs + ops runbook
- [ ] test: add unit test setup and first suites

### Rate Limiting Checklist

- [x] docs: add rate limiting plan and commit boundaries
- [x] feat: add D1-backed rate limiting for `/summary` and `/summaryday`
- [x] docs: document rate limiting behavior and tuning
- [x] feat: add stale `rate_limits` cleanup query (batched delete by `updated_at`)
- [x] feat: run cleanup from daily cron (best effort; log on failure)
- [x] docs: document cleanup retention window and tuning knobs

### Handler Refactor Checklist

- [x] docs: add refactor plan and commit boundaries (thin handlers + extracted
      application logic)
- [x] refactor: extract Telegram reply helpers and user-facing text builders to
      dedicated modules (no behavior change)
- [x] refactor: split webhook logic into application-level flow and keep
      `handleTelegramWebhook` as a thin adapter
- [x] refactor: split daily cron logic into application-level flow and keep
      `handleDailySummaryCron` as a thin adapter
- [x] docs: document retry/ack policy and updated module responsibilities

### Lint + Formatting Checklist

- [x] docs: add lint+format rollout plan and commit boundaries
- [x] chore: add Prettier config/scripts/ignore (`format`, `format:check`)
- [x] style: apply Prettier formatting (mechanical-only commit)
- [x] chore: add ESLint + `typescript-eslint` + `eslint-config-prettier`
- [x] chore: fix initial ESLint findings (no behavior change)
- [x] ci/docs: enforce `format:check` and lint in CI + contributor docs

### Strict Lint Rollout Checklist

- [x] docs: add strict lint rollout plan and commit boundaries
- [x] chore: switch ESLint presets to `strictTypeChecked` +
      `stylisticTypeChecked`
- [x] chore: apply autofixable strict/stylistic findings
- [x] chore: fix remaining strict findings manually (no behavior change)
- [x] docs: record strict preset choice and validation outcomes

### Access Control & Onboarding Checklist

- [x] docs: add auth/onboarding plan and commit boundaries
- [x] feat: add `TELEGRAM_ALLOWED_CHAT_IDS` env parsing helper
- [x] feat: enforce chat allowlist for webhook command handling, message ingest,
      and daily cron dispatch
- [x] feat: reply with self-host guidance when blocked commands come from
      non-allowlisted chats (include current `chat.id` in reply so setup does not
      require log inspection)
- [x] feat: add `/help` and `/start` command responses with usage and project
      link (`/help` available in allowed groups and DMs)
- [x] chore: register `/help` and `/start` in Telegram setup script
- [x] docs: add explicit self-host/operator-responsibility disclaimer for repo
      visitors and random bot DMs
- [x] docs: update README + ops runbook for allowlist setup and user onboarding

### Testing Rollout Checklist

- [x] docs: add testing rollout plan and commit boundaries
- [x] chore(test): add Vitest baseline (`vitest` + `test` / `test:run`
      scripts + minimal config)
- [x] test(unit): add parser tests for `parseTelegramCommand` and
      `parseAllowedChatIds`
- [x] test(webhook): add command access matrix tests for DM-only `/help` and
      `/start`, plus allowlist behavior for `/summary` and `/status`
- [x] test(rate-limit): add fixed-window counter tests for
      `enforceSummaryRateLimit`
- [x] ci: run tests in GitHub Actions quality workflow
- [ ] docs: add test commands and scope notes to README/CONTRIBUTING

## Implementation Notes

- Secrets/env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`,
  `TELEGRAM_ALLOWED_CHAT_IDS`, `WORKERS_AI_*`, `D1_DATABASE_*`.
- `TELEGRAM_ALLOWED_CHAT_IDS` is a comma-separated list of numeric Telegram
  chat IDs that are allowed to use this deployment. Use Wrangler Secrets for
  production deployments (`wrangler secret put TELEGRAM_ALLOWED_CHAT_IDS`).
  Local dev may use `.dev.vars`.
- Summary windows are hour-based: `/summary [Nh [Mh]]` uses the range from N
  hours before to M hours before, defaulting to 1h→0h.
- Bot command messages are handled for commands but excluded from message storage.
- Service-level error tracking is persisted in `service_stats`; Telegram
  alerting is deferred until an ops channel is set up.
- Telegram replies use `parse_mode: HTML` (avoid Markdown escaping / LLM confusion).
- When setting the Telegram webhook, set `allowed_updates` to only the update
  types we handle (currently `message`, `edited_message`) to reduce noise.
- Register bot commands (BotFather or `setMyCommands`) for `/summary`,
  `/summaryday`, `/status` so they show in the UI.
- Code quality split:
  - Prettier owns formatting.
  - ESLint (`typescript-eslint`) runs strict type-checked and stylistic presets.
  - Local overrides:
    - `@typescript-eslint/consistent-type-definitions`: `off`
    - `@typescript-eslint/array-type`: `off`
    - `@typescript-eslint/restrict-template-expressions`: allow numbers and
      booleans in template literals
  - `tsc --noEmit` owns type-checking correctness.

## Test / Validation Plan

- Local dev: wrangler dev and webhook test with curl or Telegram test updates.
- Automated tests (planned):
  - `pnpm test` for watch mode during development.
  - `pnpm run test:run` for CI-style non-watch execution.
  - Scope: parser logic, webhook command-access decisions, rate-limit counters.
  - Out of initial scope: brittle exact-output assertions for AI summary text.
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
