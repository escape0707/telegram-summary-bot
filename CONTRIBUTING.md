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

3. Run quality checks:

   ```bash
   pnpm run format:check
   pnpm run lint
   pnpm run lint:md
   pnpm run typecheck
   pnpm run test:run
   pnpm run test:workers
   ```

   Note: In restricted sandbox environments, `pnpm run test:workers` may need
   elevated permissions because `workerd` starts isolated runtimes.

4. Follow test scope conventions:
   - Use `*.test.ts` for Node unit tests (`vitest.config.ts`).
   - Use `*.worker.test.ts` for Workers runtime/integration tests
     (`vitest.workers.config.ts`).

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
