import { AntClient } from "./ant-client.js";
import { DedupTracker } from "./dedup.js";
import { TerminalWatcher } from "./terminal-watcher.js";
import type {
  PlatformAdapter,
  ModelAdapter,
  InboundMessage,
  AntMessage,
  BridgeConfig,
  BridgeMapping,
} from "./types.js";

const INBOUND_RATE_WINDOW_MS = 10_000;
const INBOUND_RATE_MAX = 20; // max messages per chat per window

export class BridgeCore {
  private config: BridgeConfig;
  private ant: AntClient;
  private platforms: PlatformAdapter[] = [];
  private inboundRateCounts = new Map<string, { count: number; resetAt: number }>();
  private models: ModelAdapter[] = [];
  private dedupTrackers = new Map<string, DedupTracker>();
  private mappingCache = new Map<string, BridgeMapping>(); // "platform:channelId" → mapping
  private terminalWatcher: TerminalWatcher | null = null;
  private sessionCache: { data: Array<{ id: string; name: string; type: string; archived: number }>; expiresAt: number } | null = null;
  private static SESSION_CACHE_TTL = 30_000; // 30s

  constructor(config: BridgeConfig) {
    this.config = config;
    this.ant = new AntClient(config.antUrl, config.antApiKey);
  }

  /** Unique key for an adapter — disambiguates multiple adapters on the same platform */
  private adapterKey(adapter: PlatformAdapter): string {
    if (adapter.agentId) return `${adapter.platform}:${adapter.botType || "relay"}:${adapter.agentId}`;
    return adapter.platform;
  }

  registerPlatform(adapter: PlatformAdapter): void {
    this.platforms.push(adapter);
    this.dedupTrackers.set(this.adapterKey(adapter), new DedupTracker(this.adapterKey(adapter)));

    adapter.onMessage((msg) => this.handleInbound(adapter, msg));
  }

  registerModel(adapter: ModelAdapter): void {
    this.models.push(adapter);
    this.dedupTrackers.set(adapter.name, new DedupTracker(adapter.name));
  }

  async start(): Promise<void> {
    // Health check
    const healthy = await this.ant.healthCheck();
    if (!healthy) {
      throw new Error(`Cannot reach ANT at ${this.config.antUrl}`);
    }
    console.log("[bridge] ANT is healthy");

    // Connect Socket.IO
    await this.ant.connect();

    // Load existing mappings and join those sessions
    await this.refreshMappings();

    // Listen for outbound messages (ANT → platforms)
    this.ant.onMessageCreated((msg) => this.handleOutbound(msg));

    // Start all adapters
    for (const p of this.platforms) {
      await p.start();
      console.log(`[bridge] Platform adapter started: ${p.platform}`);
    }
    for (const m of this.models) {
      await m.start();
      console.log(`[bridge] Model adapter started: ${m.displayName}`);
    }

    // Join all conversation sessions for model adapters
    if (this.models.length > 0) {
      const sessions = await this.ant.getSessions();
      for (const s of sessions) {
        if (s.type === "conversation" && !s.archived) {
          this.ant.joinSession(s.id);
        }
      }
    }

    // Start terminal watcher — watches PTY output for CLI commands
    this.terminalWatcher = new TerminalWatcher(this.config.antUrl, this.config.antApiKey);
    this.terminalWatcher.onCommand((cmd) => this.handleTerminalCommand(cmd));
    try {
      await this.terminalWatcher.connect();
      // Watch all active terminal sessions
      const allSessions = await this.ant.getSessions();
      for (const s of allSessions) {
        if (s.type === "terminal" && !s.archived) {
          this.terminalWatcher.watchSession(s.id);
        }
      }
      console.log("[bridge] Terminal watcher started");
    } catch (err) {
      console.warn("[bridge] Terminal watcher failed to connect (non-fatal):", err instanceof Error ? err.message : err);
      this.terminalWatcher = null;
    }

    console.log("[bridge] BridgeCore started");
  }

  async stop(): Promise<void> {
    for (const p of this.platforms) await p.stop();
    for (const m of this.models) await m.stop();
    this.terminalWatcher?.disconnect();
    this.ant.disconnect();
    console.log("[bridge] BridgeCore stopped");
  }

  getAntClient(): AntClient {
    return this.ant;
  }

  // --- Cached session list (30s TTL) for terminal command resolution ---

  private async getCachedSessions() {
    const now = Date.now();
    if (this.sessionCache && now < this.sessionCache.expiresAt) {
      return this.sessionCache.data;
    }
    const data = await this.ant.getSessions();
    this.sessionCache = { data, expiresAt: now + BridgeCore.SESSION_CACHE_TTL };
    return data;
  }

  // --- Terminal command: PTY output → ANT (triggers outbound routing) ---

  private async handleTerminalCommand(cmd: { sessionId: string; target: string; content: string }): Promise<void> {
    try {
      const sessions = await this.getCachedSessions();
      const target = sessions.find(
        (s) => s.type === "conversation" && s.name.toLowerCase() === cmd.target.toLowerCase()
      );

      if (!target) {
        console.warn(`[bridge] Terminal command target not found: "${cmd.target}"`);
        return;
      }

      // Post the message to the target session — this triggers handleOutbound
      // via the message_created event, routing to all mapped platforms
      await this.ant.postMessage(target.id, {
        content: cmd.content,
        role: "human",
        senderType: "agent",
        senderName: `Terminal (${cmd.sessionId.slice(0, 8)})`,
        metadata: {
          source: "terminal",
          source_session_id: cmd.sessionId,
        },
      });

      console.log(`[bridge] Terminal → ANT: "${cmd.content.slice(0, 60)}..." → session "${cmd.target}"`);
    } catch (err) {
      console.error("[bridge] Terminal command error:", err instanceof Error ? err.message : err);
    }
  }

  // --- Inbound: Platform → ANT ---

  private isRateLimited(key: string): boolean {
    const now = Date.now();
    let entry = this.inboundRateCounts.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + INBOUND_RATE_WINDOW_MS };
      this.inboundRateCounts.set(key, entry);
    }
    entry.count++;
    return entry.count > INBOUND_RATE_MAX;
  }

  private async handleInbound(adapter: PlatformAdapter, msg: InboundMessage): Promise<void> {
    const platform = adapter.platform;
    const key = this.adapterKey(adapter);

    try {
      if (this.isRateLimited(`${platform}:${msg.channelId}`)) {
        console.warn(`[bridge] Rate limited: ${platform}:${msg.channelId}`);
        return;
      }

      // --- Direct bot: single write with bot_type metadata ---
      // Echo prevention in handleOutbound checks bot_type === "direct"
      if (msg.botType === "direct" && msg.directSessionId) {
        const posted = await this.ant.postMessage(msg.directSessionId, {
          content: msg.content,
          role: "human",
          senderType: "human",
          senderName: msg.author,
          metadata: {
            source: platform,
            bot_type: "direct",
            agent_id: msg.agentId,
            [`${platform}_chat_id`]: msg.channelId,
            [`${platform}_message_id`]: msg.externalId,
          },
        });

        this.dedupTrackers.get(key)?.trackPosted(posted.id);

        console.log(`[bridge] ${key} → ANT: "${msg.content.slice(0, 60)}..." → session ${msg.directSessionId}`);
        return;
      }

      // --- Relay bot: standard path ---
      const cacheKey = `${platform}:${msg.channelId}`;
      let mapping = this.mappingCache.get(cacheKey) || null;

      if (!mapping) {
        mapping = await this.ant.getMappingByChannel(platform, msg.channelId);
        if (mapping) this.mappingCache.set(cacheKey, mapping);
      }

      // Auto-create session if enabled and no mapping
      if (!mapping && this.config.telegramAutoCreateSessions) {
        const sessionName = msg.author
          ? `Telegram: ${msg.author}`
          : `Telegram: ${msg.channelId}`;

        const session = await this.ant.createSession(sessionName, this.config.telegramDefaultWorkspace);
        mapping = await this.ant.createMapping({
          platform,
          externalChannelId: msg.channelId,
          sessionId: session.id,
          externalChannelName: msg.author || msg.channelId,
          botType: adapter.botType,
          agentId: adapter.agentId,
        });
        this.mappingCache.set(cacheKey, mapping);
        this.ant.joinSession(session.id);
        console.log(`[bridge] Auto-created session "${sessionName}" for ${key}:${msg.channelId}`);
      }

      if (!mapping) {
        console.log(`[bridge] No mapping for ${key}:${msg.channelId} — ignoring`);
        return;
      }

      if (mapping.direction === "outbound") return;

      const posted = await this.ant.postMessage(mapping.session_id, {
        content: msg.content,
        role: "human",
        senderType: "human",
        senderName: msg.author,
        metadata: {
          source: platform,
          bot_type: msg.botType || "relay",
          agent_id: msg.agentId,
          [`${platform}_chat_id`]: msg.channelId,
          [`${platform}_message_id`]: msg.externalId,
        },
      });

      this.dedupTrackers.get(key)?.trackPosted(posted.id);

      console.log(`[bridge] ${key} → ANT: "${msg.content.slice(0, 60)}..." → session ${mapping.session_id}`);
    } catch (err) {
      console.error(`[bridge] Inbound error (${key}):`, err instanceof Error ? err.message : err);
    }
  }

  // --- Outbound: ANT → Platforms ---

  private buildOutboundPrefix(msg: AntMessage): string {
    const name = msg.sender_name || null;
    const type = msg.sender_type || msg.role;
    if (type === "agent") return name ? `[ANT][${name}]` : `[ANT][Agent]`;
    if (type === "system") return `[ANT][System]`;
    if (name && name !== "human") return `[ANT][${name}]`;
    return `[ANT]`;
  }

  private async handleOutbound(msg: AntMessage): Promise<void> {
    // Parse metadata if it's a string (Socket.IO may pass raw DB row)
    if (typeof msg.metadata === "string") {
      try { msg.metadata = JSON.parse(msg.metadata); } catch { msg.metadata = null; }
    }

    // Skip direct-bot messages from being relayed back out — the direct bot
    // already delivered the message; outbound relay would cause an echo
    if (msg.metadata?.bot_type === "direct") {
      console.log(`[bridge] Outbound skip (direct bot): msg=${msg.id}`);
      return;
    }

    const text = `${this.buildOutboundPrefix(msg)} ${msg.content}`;

    // Fetch all mappings for this session once, then partition by platform
    let allMappings: BridgeMapping[];
    try {
      allMappings = await this.ant.getMappingsBySession(msg.session_id);
    } catch {
      return;
    }

    // Relay to each platform adapter — each adapter only handles its own mappings
    for (const adapter of this.platforms) {
      const key = this.adapterKey(adapter);
      const tracker = this.dedupTrackers.get(key);
      if (tracker?.shouldSkip(msg)) {
        console.log(`[bridge] Outbound skip (dedup): ${key} msg=${msg.id}`);
        continue;
      }

      // Filter mappings to only those belonging to this adapter:
      // - Platform must match
      // - If adapter has agentId, only match mappings with same agent_id
      // - If adapter has no agentId (shared relay), only match mappings without agent_id
      // - Direct adapters never handle outbound (they don't create relay mappings)
      if (adapter.botType === "direct") continue;

      const mappings = allMappings.filter((m) => {
        if (m.platform !== adapter.platform) return false;
        if (adapter.agentId) return m.agent_id === adapter.agentId;
        return !m.agent_id; // shared relay handles mappings without agent_id
      });
      if (mappings.length === 0) continue;

      try {
        console.log(`[bridge] Outbound ${key}: session=${msg.session_id} mappings=${mappings.length}`);
        for (const mapping of mappings) {
          if (mapping.direction === "inbound") continue;

          await adapter.sendMessage(mapping.external_channel_id, text, {
            senderName: msg.sender_name || undefined,
            senderType: msg.sender_type || undefined,
          });
          console.log(`[bridge] ANT → ${key}: "${text.slice(0, 60)}..."`);
        }
      } catch (err) {
        console.error(`[bridge] Outbound error (${key}):`, err instanceof Error ? err.message : err);
      }
    }

    // Relay to model adapters
    for (const model of this.models) {
      const tracker = this.dedupTrackers.get(model.name);
      if (tracker?.shouldSkip(msg)) continue;

      if (!model.shouldRespond(msg)) continue;

      try {
        const messages = await this.ant.getMessages(msg.session_id, 10);
        const response = await model.generateResponse(messages, msg);

        const posted = await this.ant.postMessage(msg.session_id, {
          content: response,
          role: "human",
          senderType: "agent",
          senderName: model.displayName,
          metadata: { source: model.name },
        });

        tracker?.trackPosted(posted.id);
        console.log(`[bridge] ${model.displayName} responded in session ${msg.session_id}`);
      } catch (err) {
        console.error(`[bridge] Model error (${model.name}):`, err instanceof Error ? err.message : err);
      }
    }
  }

  async refreshMappings(): Promise<void> {
    this.mappingCache.clear();
    const mappings = await this.ant.getAllMappings();
    for (const m of mappings) {
      this.mappingCache.set(`${m.platform}:${m.external_channel_id}`, m);
      this.ant.joinSession(m.session_id);
    }
    console.log(`[bridge] Loaded ${mappings.length} bridge mapping(s)`);
  }
}
