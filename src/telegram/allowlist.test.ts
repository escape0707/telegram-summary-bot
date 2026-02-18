import { describe, expect, it } from "vitest";
import { parseAllowedChatIds } from "./allowlist.js";

describe("parseAllowedChatIds", () => {
  it("returns empty set for undefined or blank input", () => {
    expect(parseAllowedChatIds(undefined)).toEqual(new Set<number>());
    expect(parseAllowedChatIds("   ")).toEqual(new Set<number>());
  });

  it("parses a comma-separated list and trims spaces", () => {
    expect(parseAllowedChatIds("-1001, -1002 ,1003")).toEqual(
      new Set<number>([-1001, -1002, 1003]),
    );
  });

  it("deduplicates repeated chat IDs", () => {
    expect(parseAllowedChatIds("-1001,-1001")).toEqual(
      new Set<number>([-1001]),
    );
  });

  it("throws for non-numeric values", () => {
    expect(() => parseAllowedChatIds("-1001,abc")).toThrow(
      'Invalid chat id in TELEGRAM_ALLOWED_CHAT_IDS: "abc"',
    );
  });

  it("throws for out-of-range integer values", () => {
    expect(() => parseAllowedChatIds("9007199254740992")).toThrow(
      'Chat id is out of range in TELEGRAM_ALLOWED_CHAT_IDS: "9007199254740992"',
    );
  });
});
