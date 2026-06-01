import type { ClientMessage, DriverConnectOptions, ServerMessage, TransportDriver } from "./types.ts";

export class LongPollDriver implements TransportDriver {
  readonly mode = "poll" as const;
  private abortController: AbortController | null = null;
  private token: string | null = null;
  private baseUrl: string | null = null;
  private since = "";
  private open = false;

  get isOpen(): boolean {
    return this.open;
  }

  async connect(options: DriverConnectOptions): Promise<void> {
    this.abortController = new AbortController();
    this.token = options.token;
    this.baseUrl = options.url;
    this.open = true;
    void this.poll(options);
  }

  disconnect(): void {
    this.open = false;
    this.abortController?.abort();
    this.abortController = null;
  }

  send(message: ClientMessage): void {
    if (!this.baseUrl || !this.token) {
      throw new Error("poll command channel is not open");
    }
    const cmdUrl = new URL("/api/bridge/poll/cmd", this.baseUrl);
    void fetch(cmdUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
    });
  }

  private async poll(options: DriverConnectOptions): Promise<void> {
    while (this.open && this.baseUrl && this.token) {
      const url = new URL(this.baseUrl);
      if (this.since) url.searchParams.set("since", this.since);
      try {
        const response = await fetch(url, {
          headers: { authorization: `Bearer ${this.token}` },
          signal: this.abortController?.signal,
        });
        if (!response.ok) throw new Error(`poll_failed_${response.status}`);
        const events = (await response.json()) as Array<ServerMessage & { id?: string }>;
        for (const event of events) {
          if (event.id) this.since = event.id;
          options.onMessage(event);
        }
      } catch (error) {
        if (this.open) {
          options.onError(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
    }
  }
}
