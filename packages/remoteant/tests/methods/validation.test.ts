import { describe, expect, it } from "vitest";
import { dispatch } from "../../src/mcp-stdio/methods.ts";

async function expectInvalidParams(method: string, params?: unknown) {
  const response = await dispatch({ jsonrpc: "2.0", id: 1, method, params }) as { error?: { code: number; message: string } };
  expect(response.error?.code).toBe(-32602);
  expect(response.error?.message).toMatch(/invalid params/i);
}

describe("B2 method validation", () => {
  it("rejects missing required params with -32602", async () => {
    await expectInvalidParams("ant.rooms.get");
    await expectInvalidParams("ant.chat.send", { roomId: "room_1" });
    await expectInvalidParams("ant.chat.history");
    await expectInvalidParams("ant.plans.show");
  });

  it("rejects invalid optional param types with -32602", async () => {
    await expectInvalidParams("ant.rooms.list", { limit: "five" });
    await expectInvalidParams("ant.chat.history", { roomId: "room_1", limit: 900 });
  });
});
