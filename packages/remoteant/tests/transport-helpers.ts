import type {
  ClientMessage,
  DriverConnectOptions,
  ServerMessage,
  TransportDriver,
  TransportMode,
} from "../src/transport/types.ts";

export class MockDriver implements TransportDriver {
  readonly mode: TransportMode;
  readonly failWith?: Error;
  readonly connectDelayMs: number;
  isOpen = false;
  connectOptions?: DriverConnectOptions;
  sent: ClientMessage[] = [];
  connectCalls = 0;
  disconnectCalls = 0;

  constructor(mode: TransportMode, options: { failWith?: Error; connectDelayMs?: number } = {}) {
    this.mode = mode;
    this.failWith = options.failWith;
    this.connectDelayMs = options.connectDelayMs ?? 0;
  }

  async connect(options: DriverConnectOptions): Promise<void> {
    this.connectCalls += 1;
    this.connectOptions = options;
    if (this.connectDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.connectDelayMs));
    }
    if (this.failWith) throw this.failWith;
    this.isOpen = true;
  }

  disconnect(): void {
    this.disconnectCalls += 1;
    this.isOpen = false;
  }

  send(message: ClientMessage): void {
    this.sent.push(message);
  }

  push(message: ServerMessage): void {
    this.connectOptions?.onMessage(message);
  }

  close(reason = "mock_close"): void {
    this.isOpen = false;
    this.connectOptions?.onClose(reason);
  }
}
