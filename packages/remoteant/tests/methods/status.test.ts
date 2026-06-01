import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/mcp-stdio/methods.ts";
import { installFetchMock, restoreFetch } from "./fetch-mock.ts";

describe("ant.status", () => {
  afterEach(() => restoreFetch());

  it("maps /api/health to daemon status shape", async () => {
    installFetchMock(vi.fn(async () => new Response(JSON.stringify({
      status: "ok",
      uptimeSeconds: 42,
      db: { reachable: true },
    }), { status: 200 })) as unknown as typeof fetch);

    const response = await dispatch({
      jsonrpc: "2.0",
      id: 7,
      method: "ant.status",
    }) as { result?: unknown };

    expect(response.result).toEqual({
      daemonReachable: true,
      serverVersion: "0.1.0",
      dbReachable: true,
      uptimeSeconds: 42,
    });
  });
});
