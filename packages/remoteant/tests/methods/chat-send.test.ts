import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/mcp-stdio/methods.ts";
import { installFetchMock, restoreFetch } from "./fetch-mock.ts";

describe("ant.chat.send", () => {
  afterEach(() => restoreFetch());

  it("posts a message and returns messageId plus timestamp", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      message: { id: "msg_123", postedAt: "2026-05-31T12:00:00Z" },
    }), { status: 201 }));
    installFetchMock(fetchMock as unknown as typeof fetch);

    const response = await dispatch({
      jsonrpc: "2.0",
      id: 4,
      method: "ant.chat.send",
      params: { roomId: "g6s4bwanvh", body: "B2 smoke test", kind: "agent" },
    }) as { result?: { messageId: string; ts: string } };

    const [, init] = fetchMock.mock.calls[0];
    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:6174/api/chat-rooms/g6s4bwanvh/messages");
    expect(JSON.parse(init.body as string)).toMatchObject({
      body: "B2 smoke test",
      kind: "agent",
      authorHandle: "@remoteant",
      pidChain: expect.any(Array),
    });
    expect(response.result).toEqual({ messageId: "msg_123", ts: "2026-05-31T12:00:00Z" });
  });
});
