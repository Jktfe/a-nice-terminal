import { afterEach, describe, expect, it, vi } from "vitest";
import { dispatch } from "../../src/mcp-stdio/methods.ts";
import { installFetchMock, restoreFetch } from "./fetch-mock.ts";

describe("ant.rooms.list", () => {
  afterEach(() => restoreFetch());

  it("maps daemon chatRooms response to MCP rooms shape and applies limit", async () => {
    installFetchMock(vi.fn(async () => new Response(JSON.stringify({
      chatRooms: [
        { id: "room_1", name: "Alpha", lastUpdate: "2026-05-31T10:00:00Z", archivedAtMs: null, members: [{ handle: "@you", displayName: "You", kind: "human", displayColor: "", displayIcon: "", joinedAt: "" }] },
        { id: "room_2", name: "Beta", lastUpdate: "2026-05-31T11:00:00Z", archivedAtMs: null, members: [{ handle: "@bot", displayName: "Bot", kind: "agent", displayColor: "", displayIcon: "", joinedAt: "" }] },
      ],
    }), { status: 200 })) as unknown as typeof fetch);

    const response = await dispatch({
      jsonrpc: "2.0",
      id: 2,
      method: "ant.rooms.list",
      params: { limit: 1 },
    }) as { result?: { rooms: unknown[] } };

    expect(response.result?.rooms).toEqual([
      {
        id: "room_1",
        name: "Alpha",
        lastUpdate: "2026-05-31T10:00:00Z",
        members: [{ handle: "@you", displayName: "You", kind: "human" }],
      },
    ]);
  });
});
