/**
 * GET /api/asks/:askId route tests — Task #130.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { GET } from "./+server";
import { openAskInRoom, resetAskStoreForTests } from "$lib/server/askStore";
import { createChatRoom, resetChatRoomStoreForTests } from "$lib/server/chatRoomStore";

type AnyEvent = Parameters<typeof GET>[0];

// rv1 data-scoping fix: GET /api/asks/:askId is now read-gated against the
// ask's host room. Admin-bearer retains full access (containment), which is
// what these positive-path tests assert.
const ADMIN_TOKEN_FOR_TESTS = "asks-single-server-test-admin-token";
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

function eventFor(askId: string): AnyEvent {
  const url = new URL(`http://localhost/api/asks/${askId}`);
  const request = new Request(url.toString(), {
    headers: { authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` }
  });
  return { request, params: { askId }, url } as unknown as AnyEvent;
}

async function runHandler(handler: (event: AnyEvent) => unknown, event: AnyEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrownByHandler) {
    if (thrownByHandler instanceof Response) return thrownByHandler;
    const httpFailure = thrownByHandler as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === "number") {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrownByHandler;
  }
}

describe("GET /api/asks/:askId", () => {
  beforeEach(() => {
    resetAskStoreForTests();
    resetChatRoomStoreForTests();
  });

  it("returns 404 for unknown askId", async () => {
    const response = await runHandler(GET, eventFor("no-such-ask"));
    expect(response.status).toBe(404);
  });

  it("returns the ask when found", async () => {
    const room = createChatRoom({ name: "ask-test", whoCreatedIt: "test" });
    const ask = openAskInRoom({
      roomId: room.id,
      openedByHandle: "@kimi",
      title: "Test Ask",
      body: "This is a test"
    });
    const response = await runHandler(GET, eventFor(ask.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ask.id).toBe(ask.id);
    expect(body.ask.title).toBe("Test Ask");
  });
});
