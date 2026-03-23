// Platform adapter interface — Telegram now, Slack/Discord later
export interface PlatformAdapter {
  readonly platform: string;
  /** "relay" or "direct" — used to match adapter to its own mappings in outbound routing */
  readonly botType?: "relay" | "direct";
  /** Agent identifier — adapters with an agentId only handle mappings with matching agent_id */
  readonly agentId?: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  sendMessage(channelId: string, text: string, opts?: {
    replyTo?: string;
    senderName?: string;
    senderType?: string;
  }): Promise<string>;
  onMessage(handler: (msg: InboundMessage) => void): void;
}

export interface InboundMessage {
  externalId: string;
  channelId: string;
  author: string;
  authorId: string;
  content: string;
  replyToExternalId?: string;
  timestamp: Date;
  imagePath?: string;
  /** "relay" or "direct" — which bot type received this message */
  botType?: "relay" | "direct";
  /** Agent identifier for per-agent routing */
  agentId?: string;
  /** For direct bots: the session ID the bot is auto-linked to */
  directSessionId?: string;
}

// Model adapter interface — LM Studio, Ollama, etc.
export interface ModelAdapter {
  readonly name: string;
  readonly displayName: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  shouldRespond(msg: AntMessage): boolean;
  generateResponse(messages: AntMessage[], latest: AntMessage): Promise<string>;
}

export interface AntMessage {
  id: string;
  session_id: string;
  role: "human" | "agent" | "system";
  content: string;
  format: string;
  status: string;
  metadata: Record<string, any> | null;
  sender_type?: string | null;
  sender_name?: string | null;
  created_at: string;
}

export interface BridgeMapping {
  id: string;
  platform: string;
  external_channel_id: string;
  session_id: string;
  external_channel_name: string | null;
  direction: "inbound" | "outbound" | "bidirectional";
  config: Record<string, any> | null;
  bot_type: "relay" | "direct";
  agent_id: string | null;
  created_at: string;
}

export interface AgentBotConfig {
  agentId: string;
  /** Token for the agent's direct 1:1 Telegram bot */
  directBotToken?: string;
  /** Token for the agent's relay-connected ANT bot */
  relayBotToken?: string;
  /** ANT session ID the direct bot auto-links to */
  directSessionId?: string;
}

export interface BridgeConfig {
  antUrl: string;
  antApiKey?: string;
  /** Shared relay bot token (backward compatible) */
  telegramBotToken?: string;
  telegramAutoCreateSessions: boolean;
  telegramDefaultWorkspace?: string;
  lmStudioUrl?: string;
  lmStudioModel?: string;
  /** Per-agent Telegram bot configs (direct + relay bots) */
  telegramAgents?: AgentBotConfig[];
}
