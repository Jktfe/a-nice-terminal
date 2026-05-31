import { describe, expect, it } from "vitest";
import { RemoteantTransport } from "../src/transport/index.ts";
import { MockDriver } from "./transport-helpers.ts";

describe("remoteant transport heartbeat", () => {
  it("posts heartbeat while connected and stops after disconnect", async () => {
    const ws = new MockDriver("websocket");
    const posted: Record<string, unknown>[] = [];
    let intervalCallback: (() => void) | undefined;
    const transport = new RemoteantTransport({
      serverUrl: "http://127.0.0.1:6174",
      token: "test-token",
      daemonPid: 1234,
      daemonVersion: "0.1.0 (abc1234)",
      drivers: [ws],
      heartbeatIntervalMs: 15_000,
      heartbeatPost: async (body) => {
        posted.push(body);
      },
      setHeartbeatInterval: (callback) => {
        intervalCallback = callback;
        return 1;
      },
      clearHeartbeatInterval: () => {
        intervalCallback = undefined;
      },
      now: () => 10_000,
    });

    await transport.connect();
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({
      daemonPid: 1234,
      daemonVersion: "0.1.0 (abc1234)",
      transportMode: "websocket",
    });

    intervalCallback?.();
    expect(posted).toHaveLength(2);

    transport.disconnect();
    intervalCallback?.();
    expect(posted).toHaveLength(2);
  });
});
