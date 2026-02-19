## Status Metrics Design Notes

Implement `/status` with clear metric provenance and operational value.

### 1) Separate metric categories

- `real_usage`: traffic from normal bot operation.
- `synthetic_benchmark`: controlled benchmark and simulation runs.

Recommended `/status` layout:

- `Real usage (since YYYY-MM-DD): X chats, Y summaries, Z messages`
- `Synthetic benchmark (dataset: N messages, M runs): p50/p95 latency, error rate`

This avoids mixing production behavior with benchmark output.

### 2) Record the minimum useful telemetry

For each summarize call, log:

- `timestamp`
- `source` (`real_usage` or `synthetic_benchmark`)
- `window_size` (hours/days)
- `input_message_count`
- `input_chars_or_token_estimate`
- `model`
- `latency_ms`
- `success` + `error_type` (if failed)
- `output_length`

This is enough to analyze throughput, latency distribution, failures, and cost trends.

### 3) Add a resilience mechanism

Recommended mechanism: temporary degraded mode for AI backend failures.

- If failures exceed `N` in the last `M` minutes, temporarily stop model calls.
- Return a degraded response explaining temporary unavailability.
- Record degraded-mode transitions in telemetry.

### 4) Keep demonstrations privacy-safe

- Use synthetic chat logs for benchmarks and demos.
- Show only summary output and `/status` aggregates.
- Avoid including personal message content.
