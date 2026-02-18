/// <reference types="node" />

const TELEGRAM_API_BASE = "https://api.telegram.org";
const DEFAULT_ALLOWED_UPDATES = ["message", "edited_message"];

type BotCommand = {
  command: string;
  description: string;
};

const BOT_COMMANDS: BotCommand[] = [
  { command: "summary", description: "Summarize recent chat messages" },
  {
    command: "summaryday",
    description: "Summarize messages from the last 24h",
  },
  { command: "status", description: "Show service status and counters" },
];

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

type SetupTelegramEnv = NodeJS.ProcessEnv & {
  TELEGRAM_ALLOWED_UPDATES?: string;
  TELEGRAM_DROP_PENDING_UPDATES?: string;
};

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function parseAllowedUpdates(raw?: string): string[] {
  if (!raw) {
    return [...DEFAULT_ALLOWED_UPDATES];
  }

  return raw
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parseDropPendingUpdates(raw?: string): boolean {
  if (!raw) {
    return false;
  }

  const normalized = raw.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

async function callTelegram<T>(
  token: string,
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`${TELEGRAM_API_BASE}/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const result = await response.json<TelegramApiResponse<T>>();
  if (!response.ok || !result.ok) {
    const detail = result.description ?? `HTTP ${response.status}`;
    throw new Error(`${method} failed: ${detail}`);
  }

  if (result.result === undefined) {
    throw new Error(`${method} failed: missing result`);
  }
  return result.result;
}

async function main(): Promise<void> {
  const setupEnv: SetupTelegramEnv = process.env;

  const token = requireEnv("TELEGRAM_BOT_TOKEN");
  const webhookUrl = requireEnv("TELEGRAM_WEBHOOK_URL");
  const webhookSecret = requireEnv("TELEGRAM_WEBHOOK_SECRET");
  const allowedUpdates = parseAllowedUpdates(setupEnv.TELEGRAM_ALLOWED_UPDATES);
  const dropPendingUpdates = parseDropPendingUpdates(
    setupEnv.TELEGRAM_DROP_PENDING_UPDATES,
  );

  await callTelegram<boolean>(token, "setWebhook", {
    url: webhookUrl,
    secret_token: webhookSecret,
    allowed_updates: allowedUpdates,
    drop_pending_updates: dropPendingUpdates,
  });

  await callTelegram<boolean>(token, "setMyCommands", {
    commands: BOT_COMMANDS,
  });

  console.log("Telegram webhook and commands configured.");
  console.log("Webhook URL:", webhookUrl);
  console.log("Allowed updates:", allowedUpdates.join(", "));
  console.log(
    "Commands:",
    BOT_COMMANDS.map((cmd) => `/${cmd.command}`).join(", "),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
