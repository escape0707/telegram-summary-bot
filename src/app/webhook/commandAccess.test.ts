import { describe, expect, it } from "vitest";
import { resolveCommandAccess } from "./commandAccess.js";

describe("resolveCommandAccess", () => {
  it("allows summary and status only for allowlisted chats", () => {
    expect(
      resolveCommandAccess(
        { type: "summary", fromHours: 1, toHours: 0 },
        { allowedChat: true, isPrivateChat: false },
      ),
    ).toEqual({ allowed: true });
    expect(
      resolveCommandAccess(
        { type: "summary", fromHours: 1, toHours: 0 },
        { allowedChat: false, isPrivateChat: false },
      ),
    ).toEqual({ allowed: false, reason: "not_allowlisted" });

    expect(
      resolveCommandAccess(
        { type: "status" },
        { allowedChat: true, isPrivateChat: false },
      ),
    ).toEqual({ allowed: true });
    expect(
      resolveCommandAccess(
        { type: "status" },
        { allowedChat: false, isPrivateChat: false },
      ),
    ).toEqual({ allowed: false, reason: "not_allowlisted" });
  });

  it("allows help and start in private chats even without allowlist entry", () => {
    expect(
      resolveCommandAccess(
        { type: "help" },
        { allowedChat: false, isPrivateChat: true },
      ),
    ).toEqual({ allowed: true });
    expect(
      resolveCommandAccess(
        { type: "start" },
        { allowedChat: false, isPrivateChat: true },
      ),
    ).toEqual({ allowed: true });
  });

  it("treats help and start as DM-only in all group chats", () => {
    expect(
      resolveCommandAccess(
        { type: "help" },
        { allowedChat: true, isPrivateChat: false },
      ),
    ).toEqual({ allowed: false, reason: "dm_only" });
    expect(
      resolveCommandAccess(
        { type: "help" },
        { allowedChat: false, isPrivateChat: false },
      ),
    ).toEqual({ allowed: false, reason: "dm_only" });

    expect(
      resolveCommandAccess(
        { type: "start" },
        { allowedChat: true, isPrivateChat: false },
      ),
    ).toEqual({ allowed: false, reason: "dm_only" });
    expect(
      resolveCommandAccess(
        { type: "start" },
        { allowedChat: false, isPrivateChat: false },
      ),
    ).toEqual({ allowed: false, reason: "dm_only" });
  });
});
