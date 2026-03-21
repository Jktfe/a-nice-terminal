import { io, type Socket } from "socket.io-client";
import type { AntMessage, BridgeMapping } from "./types.js";

export class AntClient {
  private baseUrl: string;
  private apiKey?: string;
  private socket: Socket | null = null;
  private messageHandlers: Array<(msg: AntMessage) => void> = [];
  private joinedSessions = new Set<string>();

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const opts: Record<string, any> = {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 30000,
        reconnectionAttempts: Infinity,
      };
      if (this.apiKey) {
        opts.auth = { apiKey: this.apiKey };
      }

      this.socket = io(this.baseUrl, opts);

      this.socket.on("connect", () => {
        console.log("[ant-client] Connected to ANT via Socket.IO");
        // Re-join sessions after reconnect
        for (const sid of this.joinedSessions) {
          this.socket!.emit("join_session", { sessionId: sid });
        }
        resolve();
      });

      this.socket.on("connect_error", (err) => {
        console.error("[ant-client] Connection error:", err.message);
      });

      this.socket.on("message_created", (msg: AntMessage) => {
        console.log(`[ant-client] message_created event: session=${msg.session_id} from=${msg.sender_name || msg.role}`);
        for (const handler of this.messageHandlers) {
          try { handler(msg); } catch (err) {
            console.error("[ant-client] Message handler error:", err);
          }
        }
      });

      // Debug: log all events
      this.socket.onAny((event: string) => {
        if (event !== "message_created") {
          console.log(`[ant-client] event: ${event}`);
        }
      });

      // Timeout after 10s
      setTimeout(() => {
        if (!this.socket?.connected) {
          reject(new Error("Failed to connect to ANT within 10s"));
        }
      }, 10000);
    });
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
  }

  joinSession(sessionId: string): void {
    this.joinedSessions.add(sessionId);
    this.socket?.emit("join_session", { sessionId });
  }

  leaveSession(sessionId: string): void {
    this.joinedSessions.delete(sessionId);
    this.socket?.emit("leave_session", { sessionId });
  }

  onMessageCreated(handler: (msg: AntMessage) => void): void {
    this.messageHandlers.push(handler);
  }

  // REST API helpers

  private async fetch(path: string, options?: RequestInit): Promise<any> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.apiKey) {
      headers["X-API-Key"] = this.apiKey;
    }

    const res = await globalThis.fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...headers, ...(options?.headers as Record<string, string>) },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`ANT API ${res.status}: ${body.slice(0, 200)}`);
    }

    return res.json();
  }

  async healthCheck(): Promise<boolean> {
    try {
      await this.fetch("/api/health");
      return true;
    } catch {
      return false;
    }
  }

  async createSession(name: string, workspaceId?: string): Promise<{ id: string; name: string }> {
    return this.fetch("/api/sessions", {
      method: "POST",
      body: JSON.stringify({
        name,
        type: "conversation",
        workspace_id: workspaceId || undefined,
      }),
    });
  }

  async postMessage(sessionId: string, opts: {
    content: string;
    role?: string;
    senderType?: string;
    senderName?: string;
    metadata?: Record<string, any>;
  }): Promise<AntMessage> {
    return this.fetch(`/api/sessions/${sessionId}/messages`, {
      method: "POST",
      body: JSON.stringify({
        role: opts.role || "human",
        content: opts.content,
        format: "markdown",
        status: "complete",
        sender_type: opts.senderType || "human",
        sender_name: opts.senderName || null,
        metadata: opts.metadata || null,
      }),
    });
  }

  async getMessages(sessionId: string, limit = 20): Promise<AntMessage[]> {
    return this.fetch(`/api/sessions/${sessionId}/messages?limit=${limit}`);
  }

  async getSessions(includeArchived = false): Promise<Array<{ id: string; name: string; type: string; archived: number }>> {
    return this.fetch(`/api/sessions?include_archived=${includeArchived}`);
  }

  async getMappingByChannel(platform: string, channelId: string): Promise<BridgeMapping | null> {
    try {
      return await this.fetch(`/api/bridge/mappings/by-channel/${platform}/${channelId}`);
    } catch {
      return null;
    }
  }

  async getMappingsBySession(sessionId: string): Promise<BridgeMapping[]> {
    return this.fetch(`/api/bridge/mappings/by-session/${sessionId}`);
  }

  async getAllMappings(platform?: string): Promise<BridgeMapping[]> {
    const qs = platform ? `?platform=${platform}` : "";
    return this.fetch(`/api/bridge/mappings${qs}`);
  }

  async createMapping(opts: {
    platform: string;
    externalChannelId: string;
    sessionId: string;
    externalChannelName?: string;
  }): Promise<BridgeMapping> {
    return this.fetch("/api/bridge/mappings", {
      method: "POST",
      body: JSON.stringify({
        platform: opts.platform,
        external_channel_id: opts.externalChannelId,
        session_id: opts.sessionId,
        external_channel_name: opts.externalChannelName,
      }),
    });
  }

  async deleteMapping(id: string): Promise<void> {
    await this.fetch(`/api/bridge/mappings/${id}`, { method: "DELETE" });
  }
}
