import type { ParsedCommand } from "../../telegram/commands.js";

export type CommandAccessContext = {
  allowedChat: boolean;
  isPrivateChat: boolean;
};

export type CommandAccessDecision =
  | { allowed: true }
  | { allowed: false; reason: "not_allowlisted" | "dm_only" };

export function resolveCommandAccess(
  command: ParsedCommand,
  access: CommandAccessContext,
): CommandAccessDecision {
  switch (command.type) {
    case "summary":
    case "status":
      return access.allowedChat
        ? { allowed: true }
        : { allowed: false, reason: "not_allowlisted" };
    case "help":
    case "start":
      return access.isPrivateChat
        ? { allowed: true }
        : { allowed: false, reason: "dm_only" };
    default: {
      const exhaustiveCheck: never = command;
      return exhaustiveCheck;
    }
  }
}
