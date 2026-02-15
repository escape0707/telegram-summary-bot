import { markServiceOk, recordServiceError } from "../db/serviceStats";
import type { Env } from "../env";

const INTERNAL_ERROR_STATUS = 500;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
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
  detail: string
): Promise<void> {
  try {
    await recordServiceError(env, `${operation}: ${detail}`);
  } catch (error) {
    console.error("Failed to update service_stats error state", {
      operation,
      detail,
      error
    });
  }
}

export async function runTrackedResponse(
  env: Env,
  operation: string,
  run: () => Promise<Response>
): Promise<Response> {
  try {
    const response = await run();
    if (response.status >= INTERNAL_ERROR_STATUS) {
      await safeRecordServiceError(env, operation, `response_${response.status}`);
    } else {
      await safeMarkServiceOk(env);
    }
    return response;
  } catch (error) {
    console.error(`${operation} failed with unhandled exception`, error);
    await safeRecordServiceError(
      env,
      operation,
      `exception: ${getErrorMessage(error)}`
    );
    return new Response("internal error", { status: 500 });
  }
}

export async function runTrackedTask(
  env: Env,
  operation: string,
  run: () => Promise<void>
): Promise<void> {
  try {
    await run();
    await safeMarkServiceOk(env);
  } catch (error) {
    console.error(`${operation} failed with unhandled exception`, error);
    await safeRecordServiceError(
      env,
      operation,
      `exception: ${getErrorMessage(error)}`
    );
  }
}
