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

  // --- Telegram adapter ---
  if (config.telegramBotToken) {
    const telegram = new TelegramAdapter({ botToken: config.telegramBotToken });
    const ant = bridge.getAntClient();

    // /link command — find session by name and create mapping
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
        });
        ant.joinSession(match.id);
        await bridge.refreshMappings();
        return match.name;
      } catch (err) {
        console.error("[bridge] Link error:", err instanceof Error ? err.message : err);
        return null;
      }
    });

    // /unlink command
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

    // /status command
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

    bridge.registerPlatform(telegram);
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
