import { describe, expect, it } from "vitest";
import { RemoteantTransport } from "../src/transport/index.ts";
import { MockDriver } from "./transport-helpers.ts";

describe("remoteant transport reconnect", () => {
  it("schedules reconnect with exponential backoff after force close", async () => {
    const ws = new MockDriver("websocket");
    const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      drivers: [ws],
      heartbeatPost: async () => {},
      backoff: (attempt) => [1_000, 2_000, 4_000, 8_000, 16_000, 30_000][attempt] ?? 30_000,
      scheduleReconnect: (delayMs, callback) => {
        scheduled.push({ delayMs, callback });
        return scheduled.length;
      },
      clearReconnect: () => {},
    });

    await transport.connect();
    ws.close("server_restart");

    expect(transport.currentState).toBe("reconnecting");
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([1_000]);

    await scheduled[0].callback();
    expect(transport.currentState).toBe("connected");
    expect(ws.connectCalls).toBe(2);

    transport.disconnect();
  });

  it("enters degraded state after five failed reconnect cycles", async () => {
    const ws = new MockDriver("websocket", { failWith: new Error("server unavailable") });
    const scheduled: Array<{ delayMs: number; callback: () => void }> = [];
    const states: string[] = [];
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      drivers: [ws],
      heartbeatPost: async () => {},
      backoff: (attempt) => [1_000, 2_000, 4_000, 8_000, 16_000, 30_000][attempt] ?? 30_000,
      scheduleReconnect: (delayMs, callback) => {
        scheduled.push({ delayMs, callback });
        return scheduled.length;
      },
      clearReconnect: () => {},
    });
    transport.onStateChange((state) => states.push(state.state));

    await transport.connect();
    for (let i = 0; i < 4; i += 1) {
      scheduled[i].callback();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect(transport.currentState).toBe("degraded");
    expect(scheduled.map((entry) => entry.delayMs)).toEqual([1_000, 2_000, 4_000, 8_000, 16_000]);
    expect(states).toContain("degraded");
  });
});
