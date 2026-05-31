import { VERSION_STRING } from "../version.ts";
import { nextBackoff } from "./reconnect.ts";
import { makeStateChange } from "./state.ts";
import { LongPollDriver } from "./poll-driver.ts";
import { SSEDriver } from "./sse-driver.ts";
import type {
  ClientMessage,
  ConnectionState,
  RemoteantNotification,
  ServerMessage,
  StateChange,
  TransportDriver,
  TransportMode,
} from "./types.ts";
import { WebSocketDriver } from "./websocket-driver.ts";

type TimerHandle = ReturnType<typeof setTimeout>;
type IntervalHandle = ReturnType<typeof setInterval>;

export type { ClientMessage, ConnectionState, ServerMessage, StateChange, TransportDriver, TransportMode };
export { WebSocketDriver, SSEDriver, LongPollDriver };
export const SseDriver = SSEDriver;
export const PollDriver = LongPollDriver;

export interface RemoteantTransportConfig {
  serverUrl: string;
  token?: string;
  daemonPid?: number;
  daemonVersion?: string;
  drivers?: TransportDriver[];
  heartbeatIntervalMs?: number;
  heartbeatPost?: (body: Record<string, unknown>) => Promise<void>;
  scheduleReconnect?: (delayMs: number, callback: () => void) => TimerHandle;
  clearReconnect?: (handle: TimerHandle) => void;
  setHeartbeatInterval?: (callback: () => void, intervalMs: number) => IntervalHandle;
  clearHeartbeatInterval?: (handle: IntervalHandle) => void;
  backoff?: (attempt: number) => number;
  now?: () => number;
}

type ResolvedConfig = Required<Omit<
  RemoteantTransportConfig,
  "token" | "daemonPid" | "daemonVersion" | "drivers" | "heartbeatPost"
>> & {
  token?: string;
  daemonPid: number;
  daemonVersion: string;
  drivers: TransportDriver[];
  heartbeatPost: (body: Record<string, unknown>) => Promise<void>;
};

export class RemoteantTransport {
  protected readonly config: ResolvedConfig;
  private state: ConnectionState = "disconnected";
  private activeDriver: TransportDriver | null = null;
  private reconnectAttempt = 0;
  private lastConnectedAtMs = 0;
  private reconnectTimer: TimerHandle | null = null;
  private heartbeatTimer: IntervalHandle | null = null;
  private readonly stateListeners = new Set<(state: StateChange) => void>();
  private readonly notificationListeners = new Set<(notification: RemoteantNotification) => void>();

  constructor(config: RemoteantTransportConfig) {
    this.config = {
      serverUrl: config.serverUrl,
      token: config.token,
      daemonPid: config.daemonPid ?? process.pid,
      daemonVersion: config.daemonVersion ?? VERSION_STRING.replace(/^remoteant\s+/, ""),
      drivers: config.drivers ?? [new WebSocketDriver(), new SSEDriver(), new LongPollDriver()],
      heartbeatIntervalMs: config.heartbeatIntervalMs ?? 15_000,
      heartbeatPost: config.heartbeatPost ?? defaultHeartbeatPost(config.serverUrl, config.token),
      scheduleReconnect: config.scheduleReconnect ?? ((delay, callback) => setTimeout(callback, delay)),
      clearReconnect: config.clearReconnect ?? ((handle) => clearTimeout(handle)),
      setHeartbeatInterval: config.setHeartbeatInterval ?? ((callback, interval) => setInterval(callback, interval)),
      clearHeartbeatInterval: config.clearHeartbeatInterval ?? ((handle) => clearInterval(handle)),
      backoff: config.backoff ?? nextBackoff,
      now: config.now ?? (() => Date.now()),
    };
  }

  get currentState(): ConnectionState {
    return this.state;
  }

  get snapshot(): StateChange {
    return makeStateChange(
      this.state,
      this.serverUrlFor(this.activeDriver?.mode ?? "websocket"),
      this.activeDriver?.mode ?? null,
      this.reconnectAttempt,
    );
  }

  get transportMode(): TransportMode | null {
    return this.activeDriver?.mode ?? null;
  }

  get isConnected(): boolean {
    return this.state === "connected" && this.activeDriver?.isOpen === true;
  }

  onStateChange(listener: (state: StateChange) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  onNotification(listener: (notification: RemoteantNotification) => void): () => void {
    this.notificationListeners.add(listener);
    return () => this.notificationListeners.delete(listener);
  }

  async connect(): Promise<void> {
    if (!this.config.token) {
      this.transition("offline", null, "ANT_ADMIN_TOKEN not set");
      return;
    }
    this.transition("connecting", null);
    const connected = await this.tryDrivers();
    if (!connected) this.scheduleReconnect("all_transports_failed");
  }

  disconnect(): void {
    if (this.reconnectTimer) {
      this.config.clearReconnect(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopHeartbeat();
    this.activeDriver?.disconnect();
    this.activeDriver = null;
    this.transition("disconnected", null);
  }

  send(message: ClientMessage): void {
    if (!this.activeDriver?.isOpen) throw new Error("remoteant transport is not connected");
    this.activeDriver.send(message);
  }

  subscribe(topic: string): void {
    this.send({ kind: "subscribe", topic });
  }

  unsubscribe(topic: string): void {
    this.send({ kind: "unsubscribe", topic });
  }

  private async tryDrivers(): Promise<boolean> {
    for (const driver of this.config.drivers) {
      try {
        await driver.connect({
          url: this.serverUrlFor(driver.mode),
          token: this.config.token!,
          onMessage: (message) => this.handleMessage(message),
          onClose: (reason) => this.handleClose(reason),
          onError: (error) => this.handleError(error),
        });
        this.activeDriver = driver;
        this.reconnectAttempt = 0;
        this.lastConnectedAtMs = this.config.now();
        this.transition("connected", driver);
        this.startHeartbeat();
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("401") || message.includes("auth")) {
          this.transition("offline", driver, "auth_invalid");
          return true;
        }
        this.transition("reconnecting", driver, message);
      }
    }
    return false;
  }

  private handleMessage(message: ServerMessage): void {
    if (message.kind === "event") {
      this.emitNotification({
        jsonrpc: "2.0",
        method: "notifications/event",
        params: { topic: message.topic, event: message.event },
      });
    }
    if (message.kind === "error" && message.code === -32002) {
      this.transition("offline", this.activeDriver, "auth_invalid");
      this.stopHeartbeat();
      this.activeDriver?.disconnect();
    }
  }

  private handleClose(reason?: string): void {
    if (this.state === "disconnected" || this.state === "offline") return;
    this.stopHeartbeat();
    this.scheduleReconnect(reason ?? "closed");
  }

  private handleError(error: Error): void {
    if (this.state === "offline") return;
    this.stopHeartbeat();
    this.scheduleReconnect(error.message);
  }

  private scheduleReconnect(lastError: string): void {
    this.activeDriver?.disconnect();
    this.activeDriver = null;
    this.reconnectAttempt += 1;
    this.transition(this.reconnectAttempt >= 5 ? "degraded" : "reconnecting", null, lastError);
    const delay = this.config.backoff(this.reconnectAttempt - 1);
    this.reconnectTimer = this.config.scheduleReconnect(delay, () => {
      void this.connect();
    });
  }

  private startHeartbeat(): void {
    this.stopHeartbeat();
    this.sendHeartbeat();
    this.heartbeatTimer = this.config.setHeartbeatInterval(() => this.sendHeartbeat(), this.config.heartbeatIntervalMs);
  }

  private stopHeartbeat(): void {
    if (!this.heartbeatTimer) return;
    this.config.clearHeartbeatInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  private sendHeartbeat(): void {
    if (!this.activeDriver?.isOpen) return;
    const body = {
      daemonPid: this.config.daemonPid,
      daemonVersion: this.config.daemonVersion,
      transportMode: this.activeDriver.mode,
      uptimeSeconds: Math.floor(process.uptime()),
    };
    this.activeDriver.send({
      kind: "heartbeat",
      ts: this.config.now(),
      daemonPid: this.config.daemonPid,
      daemonVersion: this.config.daemonVersion,
    });
    void this.config.heartbeatPost(body).catch((error) => {
      this.handleError(error instanceof Error ? error : new Error(String(error)));
    });
  }

  private transition(state: ConnectionState, driver: TransportDriver | null, lastError?: string): void {
    this.state = state;
    const change = makeStateChange(
      state,
      this.serverUrlFor(driver?.mode ?? this.activeDriver?.mode ?? "websocket"),
      driver?.mode ?? this.activeDriver?.mode ?? null,
      this.reconnectAttempt,
      lastError,
    );
    if (state === "connected") change.lastConnectedAtMs = this.lastConnectedAtMs;
    for (const listener of this.stateListeners) listener(change);
    if (state !== "disconnected") {
      this.emitNotification({
        jsonrpc: "2.0",
        method: "notifications/bridge.statusChanged",
        params: {
          state: state as Exclude<ConnectionState, "disconnected">,
          serverUrl: change.serverUrl,
          transportMode: change.transportMode,
          lastConnectedAtMs: change.lastConnectedAtMs,
          reconnectAttempt: change.reconnectAttempt,
          ...(change.lastError ? { lastError: change.lastError } : {}),
        },
      });
    }
  }

  private emitNotification(notification: RemoteantNotification): void {
    for (const listener of this.notificationListeners) listener(notification);
  }

  private serverUrlFor(mode: TransportMode): string {
    const base = new URL(this.config.serverUrl);
    if (mode === "websocket") {
      base.protocol = base.protocol === "https:" ? "wss:" : "ws:";
      base.pathname = "/api/ws/remoteant";
      base.search = "";
      return base.toString();
    }
    if (mode === "sse") {
      base.pathname = "/api/sse/remoteant";
      base.search = "";
      return base.toString();
    }
    base.pathname = "/api/bridge/poll";
    base.search = "?timeout=30000";
    return base.toString();
  }
}

export interface DriverFactory {
  mode: TransportMode;
  url: string;
  make: () => TransportDriver;
}

export class Transport extends RemoteantTransport {
  constructor(options: { daemonPid: number; daemonVersion: string; driverFactories?: DriverFactory[] }) {
    super({
      serverUrl: "http://127.0.0.1:6174",
      token: "compat-token",
      daemonPid: options.daemonPid,
      daemonVersion: options.daemonVersion,
      drivers: options.driverFactories?.map((factory) => factory.make()),
      heartbeatPost: async () => {},
    });
  }

  async connect(serverUrl?: string, token?: string): Promise<void> {
    if (serverUrl && token) Object.assign(this.config, { serverUrl, token });
    await super.connect();
  }

  onServerMessage(_handler: (msg: ServerMessage) => void): void {
    // Compatibility with the initial scaffold; B1 uses onNotification.
  }
}

function defaultHeartbeatPost(serverUrl: string, token?: string) {
  return async (body: Record<string, unknown>) => {
    const url = new URL("/api/bridge/heartbeat", serverUrl);
    await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  };
}
