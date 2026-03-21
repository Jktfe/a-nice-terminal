// Platform adapter interface — Telegram now, Slack/Discord later
export interface PlatformAdapter {
  readonly platform: string;
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
  created_at: string;
}

export interface BridgeConfig {
  antUrl: string;
  antApiKey?: string;
  telegramBotToken?: string;
  telegramAutoCreateSessions: boolean;
  telegramDefaultWorkspace?: string;
  lmStudioUrl?: string;
  lmStudioModel?: string;
}
