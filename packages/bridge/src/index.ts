import { loadConfig } from "./config.js";
import { BridgeCore } from "./core.js";
import { TelegramAdapter } from "./adapters/telegram.js";
import { LMStudioAdapter } from "./adapters/lmstudio.js";

async function main(): Promise<void> {
  const config = loadConfig();

  console.log("[ANT Bridge]");
  console.log(`  ANT:       ${config.antUrl}`);
  if (config.telegramBotToken) console.log("  Telegram:  enabled");
  if (config.lmStudioUrl) console.log(`  LM Studio: ${config.lmStudioUrl} (${config.lmStudioModel})`);
  console.log();

  const bridge = new BridgeCore(config);

  const ant = bridge.getAntClient();

  // Helper: wire up /link, /unlink, /status handlers for a relay bot
  function wireRelayHandlers(telegram: TelegramAdapter): void {
    telegram.onLink(async (chatId, sessionName) => {
      try {
        const sessions = await ant.getSessions();
        const match = sessions.find(
          (s) => s.type === "conversation" && s.name.toLowerCase() === sessionName.toLowerCase()
        );
        if (!match) return null;

        await ant.createMapping({
          platform: "telegram",
          externalChannelId: chatId,
          sessionId: match.id,
          externalChannelName: sessionName,
          botType: telegram.botType,
          agentId: telegram.agentId,
        });
        ant.joinSession(match.id);
        await bridge.refreshMappings();
        return match.name;
      } catch (err) {
        console.error("[bridge] Link error:", err instanceof Error ? err.message : err);
        return null;
      }
    });

    telegram.onUnlink(async (chatId) => {
      try {
        const mapping = await ant.getMappingByChannel("telegram", chatId);
        if (!mapping) return false;
        await ant.deleteMapping(mapping.id);
        await bridge.refreshMappings();
        return true;
      } catch (err) {
        console.error("[bridge] Unlink error:", err instanceof Error ? err.message : err);
        return false;
      }
    });

    telegram.onStatus(async (chatId) => {
      try {
        const mapping = await ant.getMappingByChannel("telegram", chatId);
        if (!mapping) return "Not linked to any ANT session.\n\nUse /link <session-name> to connect.";

        return [
          `*ANT Bridge Status*`,
          `Session: ${mapping.external_channel_name || mapping.session_id}`,
          `Direction: ${mapping.direction}`,
          `Session ID: \`${mapping.session_id}\``,
        ].join("\n");
      } catch (err) {
        return `Error checking status: ${err instanceof Error ? err.message : err}`;
      }
    });
  }

  // --- Shared relay Telegram adapter (backward compatible) ---
  if (config.telegramBotToken) {
    const telegram = new TelegramAdapter({ botToken: config.telegramBotToken, botType: "relay" });
    wireRelayHandlers(telegram);
    bridge.registerPlatform(telegram);
  }

  // --- Per-agent Telegram bots ---
  if (config.telegramAgents && config.telegramAgents.length > 0) {
    for (const agentConfig of config.telegramAgents) {
      // Direct bot for this agent
      if (agentConfig.directBotToken) {
        const directBot = new TelegramAdapter({
          botToken: agentConfig.directBotToken,
          botType: "direct",
          agentId: agentConfig.agentId,
          directSessionId: agentConfig.directSessionId,
        });
        // Direct bots get a status handler showing their config
        directBot.onStatus(async () => {
          return [
            `*ANT Direct Bot*`,
            `Agent: ${agentConfig.agentId}`,
            `Session: \`${agentConfig.directSessionId || "not configured"}\``,
            `Type: direct`,
          ].join("\n");
        });
        bridge.registerPlatform(directBot);
        console.log(`[bridge] Registered direct bot for agent: ${agentConfig.agentId}`);
      }

      // Relay bot for this agent
      if (agentConfig.relayBotToken) {
        const relayBot = new TelegramAdapter({
          botToken: agentConfig.relayBotToken,
          botType: "relay",
          agentId: agentConfig.agentId,
        });
        wireRelayHandlers(relayBot);
        bridge.registerPlatform(relayBot);
        console.log(`[bridge] Registered relay bot for agent: ${agentConfig.agentId}`);
      }
    }
  }

  // --- LM Studio model adapter ---
  if (config.lmStudioUrl) {
    const lmstudio = new LMStudioAdapter({
      url: config.lmStudioUrl,
      model: config.lmStudioModel || "openai/gpt-oss-20b",
      sessions: ["all"],
    });
    bridge.registerModel(lmstudio);
  }

  // --- Start ---
  await bridge.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\n[bridge] Received ${signal} — shutting down`);
    await bridge.stop();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error("[bridge] Fatal:", err);
  process.exit(1);
});
