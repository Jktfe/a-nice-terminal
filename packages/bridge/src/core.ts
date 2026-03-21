import { AntClient } from "./ant-client.js";
import { DedupTracker } from "./dedup.js";
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

  constructor(config: BridgeConfig) {
    this.config = config;
    this.ant = new AntClient(config.antUrl, config.antApiKey);
  }

  registerPlatform(adapter: PlatformAdapter): void {
    this.platforms.push(adapter);
    this.dedupTrackers.set(adapter.platform, new DedupTracker(adapter.platform));

    adapter.onMessage((msg) => this.handleInbound(adapter.platform, msg));
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

    console.log("[bridge] BridgeCore started");
  }

  async stop(): Promise<void> {
    for (const p of this.platforms) await p.stop();
    for (const m of this.models) await m.stop();
    this.ant.disconnect();
    console.log("[bridge] BridgeCore stopped");
  }

  getAntClient(): AntClient {
    return this.ant;
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

  private async handleInbound(platform: string, msg: InboundMessage): Promise<void> {
    try {
      if (this.isRateLimited(`${platform}:${msg.channelId}`)) {
        console.warn(`[bridge] Rate limited: ${platform}:${msg.channelId}`);
        return;
      }
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
        });
        this.mappingCache.set(cacheKey, mapping);
        this.ant.joinSession(session.id);
        console.log(`[bridge] Auto-created session "${sessionName}" for ${platform}:${msg.channelId}`);
      }

      if (!mapping) {
        console.log(`[bridge] No mapping for ${platform}:${msg.channelId} — ignoring`);
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
          [`${platform}_chat_id`]: msg.channelId,
          [`${platform}_message_id`]: msg.externalId,
        },
      });

      const tracker = this.dedupTrackers.get(platform);
      if (tracker) tracker.trackPosted(posted.id);

      console.log(`[bridge] ${platform} → ANT: "${msg.content.slice(0, 60)}..." → session ${mapping.session_id}`);
    } catch (err) {
      console.error(`[bridge] Inbound error (${platform}):`, err instanceof Error ? err.message : err);
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

    const text = `${this.buildOutboundPrefix(msg)} ${msg.content}`;

    // Fetch all mappings for this session once, then partition by platform
    let allMappings: BridgeMapping[];
    try {
      allMappings = await this.ant.getMappingsBySession(msg.session_id);
    } catch {
      return;
    }

    // Relay to each platform adapter
    for (const adapter of this.platforms) {
      const tracker = this.dedupTrackers.get(adapter.platform);
      if (tracker?.shouldSkip(msg)) {
        console.log(`[bridge] Outbound skip (dedup): ${adapter.platform} msg=${msg.id}`);
        continue;
      }

      const mappings = allMappings.filter((m) => m.platform === adapter.platform);
      if (mappings.length === 0) continue;

      try {
        console.log(`[bridge] Outbound ${adapter.platform}: session=${msg.session_id} mappings=${mappings.length}`);
        for (const mapping of mappings) {
          if (mapping.direction === "inbound") continue;

          await adapter.sendMessage(mapping.external_channel_id, text, {
            senderName: msg.sender_name || undefined,
            senderType: msg.sender_type || undefined,
          });
          console.log(`[bridge] ANT → ${adapter.platform}: "${text.slice(0, 60)}..."`);
        }
      } catch (err) {
        console.error(`[bridge] Outbound error (${adapter.platform}):`, err instanceof Error ? err.message : err);
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

  private async getMappingsForSession(sessionId: string, platform: string): Promise<BridgeMapping[]> {
    // Check cache first
    const cached: BridgeMapping[] = [];
    for (const [key, mapping] of this.mappingCache) {
      if (key.startsWith(`${platform}:`) && mapping.session_id === sessionId) {
        cached.push(mapping);
      }
    }
    if (cached.length > 0) return cached;

    // Fetch from API
    const all = await this.ant.getMappingsBySession(sessionId);
    const filtered = all.filter((m) => m.platform === platform);
    for (const m of filtered) {
      this.mappingCache.set(`${m.platform}:${m.external_channel_id}`, m);
    }
    return filtered;
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
