import type { ClientMessage, DriverConnectOptions, ServerMessage, TransportDriver } from "./types.ts";

export class SSEDriver implements TransportDriver {
  readonly mode = "sse" as const;
  private abortController: AbortController | null = null;
  private commandUrl: string | null = null;
  private token: string | null = null;
  private open = false;

  get isOpen(): boolean {
    return this.open;
  }

  async connect(options: DriverConnectOptions): Promise<void> {
    this.abortController = new AbortController();
    this.commandUrl = new URL("/api/sse/remoteant/cmd", options.url).toString();
    this.token = options.token;

    const response = await fetch(options.url, {
      headers: { authorization: `Bearer ${options.token}`, accept: "text/event-stream" },
      signal: this.abortController.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(`sse_connect_failed_${response.status}`);
    }

    this.open = true;
    void this.readStream(response.body, options);
  }

  disconnect(): void {
    this.open = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  send(message: ClientMessage): void {
    if (!this.commandUrl || !this.token) {
      throw new Error("sse command channel is not open");
    }
    void fetch(this.commandUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
    });
  }

  private async readStream(body: ReadableStream<Uint8Array>, options: DriverConnectOptions): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (this.open) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let separatorIndex: number;
        while ((separatorIndex = buffer.indexOf("\n\n")) >= 0) {
          const rawEvent = buffer.slice(0, separatorIndex);
          buffer = buffer.slice(separatorIndex + 2);
          const dataLine = rawEvent.split("\n").find((line) => line.startsWith("data:"));
          if (!dataLine) continue;
          options.onMessage(JSON.parse(dataLine.slice("data:".length).trim()) as ServerMessage);
        }
      }
    } catch (error) {
      if (this.open) {
        options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    } finally {
      if (this.open) {
        this.open = false;
        options.onClose("sse_closed");
      }
    }
  }
}
