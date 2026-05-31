import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/mcp-stdio/methods.ts";
import { installFetchMock, restoreFetch } from "./fetch-mock.ts";

describe("ant.chat.history", () => {
  afterEach(() => restoreFetch());

  it("fetches recent messages and maps to MCP history shape", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      messages: [
        { id: "msg_1", authorHandle: "@you", body: "hello", postedAt: "2026-05-31T12:00:00Z", parentMessageId: "msg_0" },
      ],
    }), { status: 200 }));
    installFetchMock(fetchMock as unknown as typeof fetch);

    const response = await dispatch({
      jsonrpc: "2.0",
      id: 5,
      method: "ant.chat.history",
      params: { roomId: "g6s4bwanvh", limit: 5 },
    }) as { result?: { messages: unknown[] } };

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:6174/api/chat-rooms/g6s4bwanvh/messages?limit=5");
    expect(response.result?.messages).toEqual([
      { id: "msg_1", handle: "@you", body: "hello", ts: "2026-05-31T12:00:00Z", replyTo: "msg_0" },
    ]);
  });
});
