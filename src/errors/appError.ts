export const ErrorCode = {
  ConfigMissing: "CONFIG_MISSING",
  DbQueryFailed: "DB_QUERY_FAILED",
  CronDispatchPartialFailure: "CRON_DISPATCH_PARTIAL_FAILURE",
  ResponseStatus: "RESPONSE_STATUS",
  UnhandledException: "UNHANDLED_EXCEPTION",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  readonly code: ErrorCode;

  constructor(code: ErrorCode, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
  }
}
