import { describe, expect, it } from "vitest";
import { buildStatusText, type StatusSummaryRunTextSnapshot } from "./texts.js";

function makeMetrics(
  overrides: Partial<StatusSummaryRunTextSnapshot> = {},
): StatusSummaryRunTextSnapshot {
  return {
    sinceTs: 1_700_000_000,
    runCount: 3,
    successCount: 2,
    failureCount: 1,
    totalInputMessageCount: 42,
    totalInputChars: 3_200,
    totalOutputChars: 640,
    avgLatencyMs: 220,
    p50LatencyMs: 180,
    p95LatencyMs: 410,
    ...overrides,
  };
}

describe("buildStatusText", () => {
  it("renders split telemetry sections and escapes error text", () => {
    const statusText = buildStatusText(
      {
        uptimeStart: 1_800_000_000,
        lastOkTs: 1_800_003_600,
        errorCount: 7,
        lastError: "bad <error> & bad",
        messageCount: 120,
        summaryCount: 33,
        realUsage: makeMetrics({
          sinceTs: 1_799_990_000,
          runCount: 10,
          successCount: 8,
          failureCount: 2,
          totalInputMessageCount: 250,
          totalInputChars: 18_000,
          totalOutputChars: 4_200,
          avgLatencyMs: 340,
          p50LatencyMs: 300,
          p95LatencyMs: 710,
        }),
        syntheticBenchmark: makeMetrics({
          sinceTs: 1_799_995_000,
          runCount: 4,
          successCount: 4,
          failureCount: 0,
          totalInputMessageCount: 800,
          totalInputChars: 48_000,
          totalOutputChars: 6_500,
          avgLatencyMs: 260,
          p50LatencyMs: 250,
          p95LatencyMs: 310,
        }),
      },
      1_800_007_200,
    );

    expect(statusText).toContain("<b>Status</b>");
    expect(statusText).toContain("Uptime: 0d 2h 0m");
    expect(statusText).toContain("Last error: bad &lt;error&gt; &amp; bad");
    expect(statusText).toContain("<b>Real usage</b>");
    expect(statusText).toContain("Runs: 10 (ok 8, failed 2)");
    expect(statusText).toContain("Latency ms (avg/p50/p95): 340/300/710");
    expect(statusText).toContain("<b>Synthetic benchmark</b>");
    expect(statusText).toContain("Runs: 4 (ok 4, failed 0)");
    expect(statusText).toContain("Latency ms (avg/p50/p95): 260/250/310");
  });

  it("uses n/a placeholders when telemetry has no runs yet", () => {
    const statusText = buildStatusText(
      {
        uptimeStart: 1_800_000_000,
        lastOkTs: null,
        errorCount: 0,
        lastError: null,
        messageCount: 0,
        summaryCount: 0,
        realUsage: makeMetrics({
          sinceTs: null,
          runCount: 0,
          successCount: 0,
          failureCount: 0,
          totalInputMessageCount: 0,
          totalInputChars: 0,
          totalOutputChars: 0,
          avgLatencyMs: null,
          p50LatencyMs: null,
          p95LatencyMs: null,
        }),
        syntheticBenchmark: makeMetrics({
          sinceTs: null,
          runCount: 0,
          successCount: 0,
          failureCount: 0,
          totalInputMessageCount: 0,
          totalInputChars: 0,
          totalOutputChars: 0,
          avgLatencyMs: null,
          p50LatencyMs: null,
          p95LatencyMs: null,
        }),
      },
      1_800_000_000,
    );

    expect(statusText).toContain("Last OK: n/a");
    expect(statusText).toContain("Last error: none");
    expect(statusText).toContain("Since: n/a");
    expect(statusText).toContain("Latency ms (avg/p50/p95): n/a/n/a/n/a");
  });
});
