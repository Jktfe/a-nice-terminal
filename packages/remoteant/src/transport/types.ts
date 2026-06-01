export type TransportMode = "websocket" | "sse" | "poll";

export type ConnectionState =
  | "disconnected"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "degraded"
  | "offline";

export interface StateChange {
  state: ConnectionState;
  serverUrl: string;
  transportMode: TransportMode | null;
  lastConnectedAtMs: number;
  reconnectAttempt: number;
  lastError?: string;
}

export type ClientMessage =
  | { kind: "heartbeat"; ts: number; daemonPid: number; daemonVersion: string }
  | { kind: "subscribe"; topic: string }
  | { kind: "unsubscribe"; topic: string };

export type ServerMessage =
  | { kind: "event"; topic: string; event: unknown }
  | { kind: "ack"; ref: string; ts: number }
  | { kind: "error"; code: number; message: string };

export interface DriverConnectOptions {
  url: string;
  token: string;
  onMessage: (msg: ServerMessage) => void;
  onClose: (reason?: string) => void;
  onError: (error: Error) => void;
}

export interface TransportDriver {
  readonly mode: TransportMode;
  connect(options: DriverConnectOptions): Promise<void>;
  disconnect(): void;
  send(msg: ClientMessage): void;
  readonly isOpen: boolean;
}

export interface BridgeStatusNotification {
  jsonrpc: "2.0";
  method: "notifications/bridge.statusChanged";
  params: {
    state: Exclude<ConnectionState, "disconnected">;
    serverUrl: string;
    transportMode: TransportMode | null;
    lastConnectedAtMs: number;
    reconnectAttempt: number;
    lastError?: string;
  };
}

export interface EventNotification {
  jsonrpc: "2.0";
  method: "notifications/event";
  params: {
    topic: string;
    event: unknown;
  };
}

export type RemoteantNotification = BridgeStatusNotification | EventNotification;
