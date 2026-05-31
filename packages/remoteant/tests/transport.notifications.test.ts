import { describe, expect, it } from "vitest";
import { RemoteantTransport, type RemoteantNotification } from "../src/transport/index.ts";
import { MockDriver } from "./transport-helpers.ts";

describe("remoteant transport notifications", () => {
  it("emits bridge.statusChanged notifications with the contracted schema", async () => {
    const ws = new MockDriver("websocket");
    const notifications: RemoteantNotification[] = [];
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      drivers: [ws],
      heartbeatPost: async () => {},
      now: () => 1_700_000_000_000,
    });
    transport.onNotification((notification) => notifications.push(notification));

    await transport.connect();

    const status = notifications.find((notification) =>
      notification.method === "notifications/bridge.statusChanged" && notification.params.state === "connected"
    );
    expect(status).toBeTruthy();
    expect(status?.params).toMatchObject({
      state: "connected",
      serverUrl: "ws://127.0.0.1:6174/api/ws/remoteant",
      transportMode: "websocket",
      lastConnectedAtMs: 1_700_000_000_000,
      reconnectAttempt: 0,
    });

    transport.disconnect();
  });

  it("surfaces pushed server events as notifications/event", async () => {
    const ws = new MockDriver("websocket");
    const notifications: RemoteantNotification[] = [];
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      drivers: [ws],
      heartbeatPost: async () => {},
    });
    transport.onNotification((notification) => notifications.push(notification));

    await transport.connect();
    ws.push({ kind: "event", topic: "rooms", event: { type: "message_added", messageId: "msg_1" } });

    expect(notifications).toContainEqual({
      jsonrpc: "2.0",
      method: "notifications/event",
      params: {
        topic: "rooms",
        event: { type: "message_added", messageId: "msg_1" },
      },
    });

    transport.disconnect();
  });
});
