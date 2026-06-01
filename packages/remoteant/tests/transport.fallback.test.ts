import { describe, expect, it } from "vitest";
import { RemoteantTransport } from "../src/transport/index.ts";
import { MockDriver } from "./transport-helpers.ts";

describe("remoteant transport fallback", () => {
  it("connects over websocket within the active connect path", async () => {
    const ws = new MockDriver("websocket");
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      drivers: [ws],
      heartbeatPost: async () => {},
    });

    await transport.connect();

    expect(transport.currentState).toBe("connected");
    expect(transport.transportMode).toBe("websocket");
    expect(ws.connectCalls).toBe(1);
    expect(ws.connectOptions?.url).toBe("ws://127.0.0.1:6174/api/ws/remoteant");

    transport.disconnect();
  });

  it("falls back from websocket to SSE when websocket connect fails", async () => {
    const ws = new MockDriver("websocket", { failWith: new Error("ws unavailable") });
    const sse = new MockDriver("sse");
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      drivers: [ws, sse],
      heartbeatPost: async () => {},
    });

    await transport.connect();

    expect(transport.currentState).toBe("connected");
    expect(transport.transportMode).toBe("sse");
    expect(ws.connectCalls).toBe(1);
    expect(sse.connectCalls).toBe(1);
    expect(sse.connectOptions?.url).toBe("http://127.0.0.1:6174/api/sse/remoteant");

    transport.disconnect();
  });

  it("falls back from websocket and SSE to poll when both preferred transports fail", async () => {
    const ws = new MockDriver("websocket", { failWith: new Error("ws unavailable") });
    const sse = new MockDriver("sse", { failWith: new Error("sse unavailable") });
    const poll = new MockDriver("poll");
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      drivers: [ws, sse, poll],
      heartbeatPost: async () => {},
    });

    await transport.connect();

    expect(transport.currentState).toBe("connected");
    expect(transport.transportMode).toBe("poll");
    expect(poll.connectOptions?.url).toBe("http://127.0.0.1:6174/api/bridge/poll?timeout=30000");

    transport.disconnect();
  });
});
