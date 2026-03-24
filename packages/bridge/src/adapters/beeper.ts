/**
 * BeeperAdapter — unified platform adapter for all messaging networks.
 *
 * Replaces per-platform adapters (Telegram, WhatsApp, Signal, etc.) with
 * a single integration via Beeper Desktop's local API.
 *
 * Inbound: WebSocket /v1/ws → message.upserted events → ANT sessions
 * Outbound: ANT messages → POST /v1/chats/{chatID}/messages
 */
import type { PlatformAdapter, InboundMessage } from "../types.js";
import { BeeperAuth, type BeeperTokens } from "./beeper-auth.js";

export interface BeeperAdapterConfig {
  beeperUrl: string;
  chatIds?: string[]; // specific chats to bridge, or empty for manual mapping
  /** Token storage callbacks — bridge core provides these backed by server_state */
  loadTokens: () => Promise<BeeperTokens | null>;
  saveTokens: (tokens: BeeperTokens) => Promise<void>;
  clearTokens: () => Promise<void>;
}

interface BeeperMessage {
  id: string;
  chatID: string;
  accountID: string;
  senderID: string;
  senderName: string;
  timestamp: string;
  type: string;
  text?: string;
}

interface BeeperChat {
  id: string;
  title: string;
  accountID: string;
  type: "single" | "group";
}

/**
 * Extract the network name from a Beeper accountID.
 * e.g. "local-whatsapp_ba_xxx" → "whatsapp"
 *      "local-telegram_ba_xxx" → "telegram"
 */
function extractNetwork(accountID: string): string {
  const match = accountID.match(/^local-(\w+)/);
  return match ? match[1] : "unknown";
}

export class BeeperAdapter implements PlatformAdapter {
  readonly platform = "beeper";
  readonly botType = "relay" as const;

  private config: BeeperAdapterConfig;
  private auth: BeeperAuth;
  private ws: WebSocket | null = null;
  private messageHandler: ((msg: InboundMessage) => void) | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(config: BeeperAdapterConfig) {
    this.config = config;
    this.auth = new BeeperAuth({
      beeperUrl: config.beeperUrl,
      loadTokens: config.loadTokens,
      saveTokens: config.saveTokens,
      clearTokens: config.clearTokens,
    });
  }

  async start(): Promise<void> {
    this.running = true;

    // Authenticate (may open browser on first run)
    try {
      await this.auth.getAccessToken();
      console.log("[beeper] Authenticated successfully");
    } catch (err) {
      console.error("[beeper] Authentication failed:", err instanceof Error ? err.message : err);
      return;
    }

    // Discover connected accounts
    try {
      const res = await this.auth.fetch("/v1/accounts");
      if (res.ok) {
        const accounts = await res.json() as Array<{ accountID: string; user: { fullName?: string } }>;
        const networks = accounts.map((a) => extractNetwork(a.accountID));
        console.log(`[beeper] Connected networks: ${networks.join(", ")}`);
      }
    } catch {
      console.warn("[beeper] Failed to discover accounts");
    }

    // Connect WebSocket for inbound messages
    await this.connectWebSocket();
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  onMessage(handler: (msg: InboundMessage) => void): void {
    this.messageHandler = handler;
  }

  async sendMessage(channelId: string, text: string, opts?: {
    replyTo?: string;
    senderName?: string;
    senderType?: string;
  }): Promise<string> {
    const body: Record<string, any> = { text };
    if (opts?.replyTo) body.replyToMessageID = opts.replyTo;

    const res = await this.auth.fetch(`/v1/chats/${encodeURIComponent(channelId)}/messages`, {
      method: "POST",
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Beeper send failed: ${res.status} ${errText.slice(0, 200)}`);
    }

    const data = await res.json() as { id: string };
    return data.id;
  }

  /**
   * List available chats across all networks.
   */
  async listChats(limit = 50): Promise<BeeperChat[]> {
    const res = await this.auth.fetch(`/v1/chats?limit=${limit}`);
    if (!res.ok) throw new Error(`List chats failed: ${res.status}`);
    const data = await res.json() as { items: BeeperChat[] };
    return data.items || [];
  }

  /**
   * Search messages across all networks.
   */
  async searchMessages(query: string, limit = 20): Promise<any[]> {
    const res = await this.auth.fetch(`/v1/search?q=${encodeURIComponent(query)}&limit=${limit}`);
    if (!res.ok) throw new Error(`Search failed: ${res.status}`);
    return res.json();
  }

  /**
   * List connected accounts/networks.
   */
  async listAccounts(): Promise<Array<{ accountID: string; network: string; user: any }>> {
    const res = await this.auth.fetch("/v1/accounts");
    if (!res.ok) throw new Error(`List accounts failed: ${res.status}`);
    const accounts = await res.json() as Array<{ accountID: string; user: any }>;
    return accounts.map((a) => ({
      ...a,
      network: extractNetwork(a.accountID),
    }));
  }

  // ---------------------------------------------------------------------------
  // WebSocket — real-time inbound messages
  // ---------------------------------------------------------------------------

  private async connectWebSocket(): Promise<void> {
    if (!this.running) return;

    try {
      const token = await this.auth.getAccessToken();
      const wsUrl = this.config.beeperUrl.replace(/^http/, "ws") + "/v1/ws";

      this.ws = new WebSocket(wsUrl, {
        headers: { Authorization: `Bearer ${token}` },
      } as any);

      this.ws.onopen = () => {
        console.log("[beeper] WebSocket connected");

        // Subscribe to configured chats (or all)
        const chatIds = this.config.chatIds?.length ? this.config.chatIds : ["*"];
        this.ws!.send(JSON.stringify({
          type: "subscriptions.set",
          chatIDs: chatIds,
        }));
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(String(event.data));
          if (data.type === "message.upserted") {
            this.handleInboundMessage(data.message || data);
          }
        } catch {
          // Ignore malformed messages
        }
      };

      this.ws.onclose = () => {
        console.log("[beeper] WebSocket disconnected");
        this.scheduleReconnect();
      };

      this.ws.onerror = (err) => {
        console.warn("[beeper] WebSocket error:", err);
      };
    } catch (err) {
      console.error("[beeper] WebSocket connection failed:", err instanceof Error ? err.message : err);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (!this.running) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      console.log("[beeper] Reconnecting WebSocket...");
      this.connectWebSocket();
    }, 5000);
  }

  private handleInboundMessage(msg: BeeperMessage): void {
    if (!this.messageHandler) return;

    // Skip non-text messages for now
    if (msg.type !== "TEXT" && msg.type !== "NOTICE") return;
    if (!msg.text) return;

    const network = extractNetwork(msg.accountID);

    this.messageHandler({
      externalId: msg.id,
      channelId: msg.chatID,
      author: msg.senderName || "Unknown",
      authorId: msg.senderID,
      content: msg.text,
      timestamp: new Date(msg.timestamp),
      botType: "relay",
      // Metadata for platform badge display in ANT UI
      // The bridge core will add this to the ANT message metadata
    });
  }
}
