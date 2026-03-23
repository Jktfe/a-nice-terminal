import type { BridgeConfig, AgentBotConfig } from "./types.js";

/**
 * Parse TELEGRAM_AGENTS env var into per-agent bot configs.
 * Format: agentId|directToken|relayToken|sessionId,...
 * Uses | as delimiter because Telegram bot tokens contain colons.
 * Any field can be empty (use || to skip), e.g.:
 *   mmd|123:ABCdef|456:GHIjkl|session_id   — both bots
 *   mmd|123:ABCdef||session_id              — direct bot only
 *   mmd||456:GHIjkl|                        — relay bot only
 */
function parseAgentConfigs(): AgentBotConfig[] {
  const raw = process.env.TELEGRAM_AGENTS;
  if (!raw) return [];

  return raw.split(",").map((entry) => {
    const [agentId, directBotToken, relayBotToken, directSessionId] = entry.trim().split("|");
    return {
      agentId: agentId || "",
      directBotToken: directBotToken || undefined,
      relayBotToken: relayBotToken || undefined,
      directSessionId: directSessionId || undefined,
    };
  }).filter((c) => c.agentId);
}

export function loadConfig(): BridgeConfig {
  return {
    antUrl: process.env.ANT_URL || "http://localhost:6458",
    antApiKey: process.env.ANT_API_KEY || undefined,
    telegramBotToken: process.env.TELEGRAM_BOT_TOKEN || undefined,
    telegramAutoCreateSessions: process.env.TELEGRAM_AUTO_CREATE_SESSIONS !== "false",
    telegramDefaultWorkspace: process.env.TELEGRAM_DEFAULT_WORKSPACE || undefined,
    lmStudioUrl: process.env.LM_STUDIO_URL || "http://localhost:1234",
    lmStudioModel: process.env.LM_STUDIO_MODEL || "openai/gpt-oss-20b",
    telegramAgents: parseAgentConfigs(),
  };
}
