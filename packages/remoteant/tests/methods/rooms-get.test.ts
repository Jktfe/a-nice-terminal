import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/mcp-stdio/methods.ts";
import { installFetchMock, restoreFetch } from "./fetch-mock.ts";

describe("ant.rooms.get", () => {
  afterEach(() => restoreFetch());

  it("fetches one room and maps members", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      chatRoom: {
        id: "g6s4bwanvh",
        name: "remoteant on mac",
        members: [{ handle: "@homebrewmaincodex", displayName: "Codex", kind: "agent", joinedAt: "", displayColor: "", displayIcon: "" }],
      },
    }), { status: 200 }));
    installFetchMock(fetchMock as unknown as typeof fetch);

    const response = await dispatch({
      jsonrpc: "2.0",
      id: 3,
      method: "ant.rooms.get",
      params: { roomId: "g6s4bwanvh" },
    }) as { result?: { room: unknown } };

    expect(fetchMock.mock.calls[0][0]).toBe("http://127.0.0.1:6174/api/chat-rooms/g6s4bwanvh");
    expect(response.result?.room).toEqual({
      id: "g6s4bwanvh",
      name: "remoteant on mac",
      members: [{ handle: "@homebrewmaincodex", displayName: "Codex", kind: "agent" }],
    });
  });
});
