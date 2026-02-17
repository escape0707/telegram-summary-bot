# File Structure Proposal

Date: 2026-02-17

## Goal

Keep the current clean layering, remove emerging ambiguity (`summary`, `ops`),
and add a clear path for tests without over-engineering.

## Current Strengths

- Clear entrypoint and adapters (`src/index.ts`, `src/handlers/*`).
- Use-case orchestration already lives in `src/app/*`.
- External integrations are isolated (`src/db`, `src/telegram`, `src/ai`).

## Proposed Target Structure (minimal refactor)

```text
src/
  index.ts
  config.ts
  env.ts
  handlers/
    telegramWebhook.ts
    dailySummaryCron.ts
  app/
    webhook/
      processTelegramWebhookRequest.ts
    cron/
      runDailySummary.ts
    summary/
      summarizeWindow.ts
  db/
    messages.ts
    rateLimits.ts
    serviceStats.ts
  telegram/
    api.ts
    commands.ts
    links.ts
    replies.ts
    texts.ts
    types.ts
  ai/
    summary.ts
  observability/
    serviceTracking.ts
  errors/
    appError.ts
test/
  unit/
    telegram/
    app/
    db/
  integration/
```

## Why This Layout

- `src/app/summary/summarizeWindow.ts` keeps all use-case orchestration inside `app`.
- `src/observability` names cross-cutting runtime tracking more precisely than `ops`.
- `src/errors/appError.ts` keeps reusable error primitives explicit and discoverable.
- `test/` makes quality work visible and scales better than ad hoc test placement.

## Commit Boundaries (review-friendly)

1. `docs: add file-structure proposal`
   - Add this document only.
2. `refactor: move summary window use-case under src/app/summary`
   - Move `src/summary/window.ts` to `src/app/summary/summarizeWindow.ts`.
   - Update imports only. No behavior change.
3. `refactor: split ops into observability and errors modules`
   - Move `src/ops/serviceTracking.ts` -> `src/observability/serviceTracking.ts`.
   - Move `src/ops/errors.ts` -> `src/errors/appError.ts`.
   - Update imports only. No behavior change.
4. `test: add baseline test structure and first unit suites`
   - Add test runner config and `test/` folders.
   - Start with pure functions (`telegram/commands`, `telegram/links`, `telegram/texts`).
5. `test: add webhook and cron flow integration tests (mocked bindings)`
   - Cover ack/retry semantics and failure paths.

## Non-Goals

- No domain-driven rewrite.
- No functional behavior changes in refactor commits.
- No package split/monorepo changes.
