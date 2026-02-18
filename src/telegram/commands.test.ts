import { describe, expect, it } from "vitest";
import { MAX_SUMMARY_HOURS } from "../config.js";
import { parseTelegramCommand } from "./commands.js";

describe("parseTelegramCommand", () => {
  it("parses /summary defaults", () => {
    expect(parseTelegramCommand("/summary")).toEqual({
      ok: true,
      command: { type: "summary", fromHours: 1, toHours: 0 },
    });
  });

  it("parses /summary with explicit hours", () => {
    expect(parseTelegramCommand("/summary 3h 1h")).toEqual({
      ok: true,
      command: { type: "summary", fromHours: 3, toHours: 1 },
    });
  });

  it("normalizes zero-hour from value to one hour", () => {
    expect(parseTelegramCommand("/summary 0h")).toEqual({
      ok: true,
      command: { type: "summary", fromHours: 1, toHours: 0 },
    });
  });

  it("parses summaryday alias", () => {
    expect(parseTelegramCommand("/summaryday")).toEqual({
      ok: true,
      command: { type: "summary", fromHours: 24, toHours: 0 },
    });
  });

  it("parses status/help/start commands", () => {
    expect(parseTelegramCommand("/status")).toEqual({
      ok: true,
      command: { type: "status" },
    });
    expect(parseTelegramCommand("/help")).toEqual({
      ok: true,
      command: { type: "help" },
    });
    expect(parseTelegramCommand("/start")).toEqual({
      ok: true,
      command: { type: "start" },
    });
  });

  it("supports bot mention suffix in command token", () => {
    expect(parseTelegramCommand("/help@my_bot")).toEqual({
      ok: true,
      command: { type: "help" },
    });
  });

  it("returns invalid arguments for malformed summary args", () => {
    expect(parseTelegramCommand("/summary foo")).toEqual({
      ok: false,
      reason: "invalid arguments",
    });
    expect(parseTelegramCommand("/summary 2h 2h")).toEqual({
      ok: false,
      reason: "invalid arguments",
    });
  });

  it("returns exceeds max hours for out-of-range summary window", () => {
    expect(parseTelegramCommand(`/summary ${MAX_SUMMARY_HOURS + 1}h`)).toEqual({
      ok: false,
      reason: "exceeds max hours",
    });
  });

  it("returns unknown command for unsupported or empty command", () => {
    expect(parseTelegramCommand("/doesnotexist")).toEqual({
      ok: false,
      reason: "unknown command",
    });
    expect(parseTelegramCommand("   ")).toEqual({
      ok: false,
      reason: "unknown command",
    });
  });
});
