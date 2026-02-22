import type { SummaryCommand } from "../telegram/commands.js";

export const SUMMARY_JOB_TYPE_ON_DEMAND = "on_demand";
export const SUMMARY_JOB_TYPE_DAILY = "daily";

export type OnDemandSummaryJob = {
  type: typeof SUMMARY_JOB_TYPE_ON_DEMAND;
  jobId: string;
  chatId: number;
  chatUsername?: string;
  command: SummaryCommand;
  requestedAtTs: number;
  requesterUserId: number | null;
  replyToMessageId: number;
};

export type DailySummaryJob = {
  type: typeof SUMMARY_JOB_TYPE_DAILY;
  jobId: string;
  chatId: number;
  chatUsername?: string;
  windowStart: number;
  windowEnd: number;
  scheduledAtTs: number;
};

export type SummaryQueueMessage = OnDemandSummaryJob | DailySummaryJob;
