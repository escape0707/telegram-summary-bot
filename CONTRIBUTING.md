# Contributing

Thanks for your interest in contributing.

## Development Setup

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Start local development worker:

   ```bash
   pnpm dev
   ```

3. Run typecheck:

   ```bash
   pnpm exec tsc --noEmit --pretty false
   ```

## Style Notes

- TypeScript-first for source and utility scripts where possible.
- Preserve existing project conventions unless there is a strong reason to
  change them.

## Pull Requests

Please include:

1. What changed.
2. Why it changed.
3. How it was validated.

## AI-Assisted Contributions

AI-assisted coding and PR preparation are welcome.
Before submitting a PR, you must scrutinize the final changes for
correctness, security, and maintainability.
