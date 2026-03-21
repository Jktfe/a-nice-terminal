import type { BridgeConfig } from "./types.js";

export function loadConfig(): BridgeConfig {
  return {
    antUrl: process.env.ANT_URL || "http://localhost:6458",
    antApiKey: process.env.ANT_API_KEY || undefined,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramAutoCreateSessions: process.env.TELEGRAM_AUTO_CREATE_SESSIONS !== "false",
    telegramDefaultWorkspace: process.env.TELEGRAM_DEFAULT_WORKSPACE || undefined,
    lmStudioUrl: process.env.LM_STUDIO_URL || "http://localhost:1234",
    lmStudioModel: process.env.LM_STUDIO_MODEL || "openai/gpt-oss-20b",
  };
}
