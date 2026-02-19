import { markServiceOk, recordServiceError } from "../db/serviceStats.js";
import type { Env } from "../env.js";
import {
  AppError,
  ErrorCode,
  type ErrorCode as AppErrorCode,
} from "../errors/appError.js";

const INTERNAL_ERROR_STATUS = 500;

type TrackedError = {
  code: AppErrorCode;
  detail: string;
};

function getTrackedError(error: unknown): TrackedError {
  if (error instanceof AppError) {
    return { code: error.code, detail: error.message };
  }
  if (error instanceof Error) {
    return { code: ErrorCode.UnhandledException, detail: error.message };
  }
  if (typeof error === "string") {
    return { code: ErrorCode.UnhandledException, detail: error };
  }
  return { code: ErrorCode.UnhandledException, detail: String(error) };
}

async function safeMarkServiceOk(env: Env): Promise<void> {
  try {
    await markServiceOk(env);
  } catch (error) {
    console.error("Failed to update service_stats last_ok_ts", error);
  }
}

async function safeRecordServiceError(
  env: Env,
  operation: string,
  code: AppErrorCode,
  detail: string,
): Promise<void> {
  try {
    await recordServiceError(env, `${operation} [${code}] ${detail}`);
  } catch (error) {
    console.error("Failed to update service_stats error state", {
      operation,
      code,
      detail,
      error,
    });
  }
}

async function trackInBackground(
  task: Promise<void>,
  waitUntil?: ExecutionContext["waitUntil"],
): Promise<void> {
  if (waitUntil) {
    waitUntil(task);
    return;
  }

  await task;
}

export async function runTrackedResponse(
  env: Env,
  operation: string,
  run: () => Promise<Response>,
  waitUntil?: ExecutionContext["waitUntil"],
): Promise<Response> {
  try {
    const response = await run();
    if (response.status >= INTERNAL_ERROR_STATUS) {
      await trackInBackground(
        safeRecordServiceError(
          env,
          operation,
          ErrorCode.ResponseStatus,
          `status=${response.status}`,
        ),
        waitUntil,
      );
    } else {
      await trackInBackground(safeMarkServiceOk(env), waitUntil);
    }
    return response;
  } catch (error) {
    const trackedError = getTrackedError(error);
    console.error(`${operation} failed`, { trackedError, error });
    await trackInBackground(
      safeRecordServiceError(
        env,
        operation,
        trackedError.code,
        trackedError.detail,
      ),
      waitUntil,
    );
    return new Response("internal error", { status: 500 });
  }
}

export async function runTrackedTask(
  env: Env,
  operation: string,
  run: () => Promise<void>,
  waitUntil?: ExecutionContext["waitUntil"],
): Promise<void> {
  try {
    await run();
    await trackInBackground(safeMarkServiceOk(env), waitUntil);
  } catch (error) {
    const trackedError = getTrackedError(error);
    console.error(`${operation} failed`, { trackedError, error });
    await trackInBackground(
      safeRecordServiceError(
        env,
        operation,
        trackedError.code,
        trackedError.detail,
      ),
      waitUntil,
    );
  }
}
