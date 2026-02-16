# Changelog

## [Unreleased]

### Added

- Telegram group message ingest to D1.
- On-demand summary commands:
  - `/summary [Nh [Mh]]`
  - `/summaryday`
- `/status` command for service counters and health snapshot.
- Daily cron-triggered summary dispatch.
- Centralized service error tracking in `service_stats`.
- GitHub Actions CI workflow (typecheck).
- Manual GitHub Actions deploy workflow.
- Telegram setup script for webhook and bot command registration.
- Project docs and ops runbook.
- AGPL-3.0 `LICENSE` and root `COPYRIGHT` notice.
- D1-backed rate limiting for `/summary` and `/summaryday`:
  - Per-user-in-chat: 3 requests / 10 minutes.
  - Per-chat: 20 requests / 10 minutes.
