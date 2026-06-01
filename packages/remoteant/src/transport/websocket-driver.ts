import type { ClientMessage, DriverConnectOptions, ServerMessage, TransportDriver } from "./types.ts";

export class WebSocketDriver implements TransportDriver {
  readonly mode = "websocket" as const;
  private socket: WebSocket | null = null;

  get isOpen(): boolean {
    return this.socket?.readyState === WebSocket.OPEN;
  }

  connect(options: DriverConnectOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket(options.url, {
        headers: { authorization: `Bearer ${options.token}` },
      } as unknown as string | string[]);
      this.socket = socket;

      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error("websocket_connect_failed"));
      socket.onclose = (event) => options.onClose(`websocket_closed_${event.code}`);
      socket.onmessage = (event) => {
        try {
          options.onMessage(JSON.parse(String(event.data)) as ServerMessage);
        } catch (error) {
          options.onError(error instanceof Error ? error : new Error(String(error)));
        }
      };
    });
  }

  disconnect(): void {
    this.socket?.close();
    this.socket = null;
  }

  send(message: ClientMessage): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("websocket is not open");
    }
    this.socket.send(JSON.stringify(message));
  }
}
