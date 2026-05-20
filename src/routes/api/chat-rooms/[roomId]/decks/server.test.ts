/**
 * Decks route tests — Task #126 v3-parity.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DELETE, GET, PATCH, POST } from "./+server";
import { GET as GET_PUBLIC_DECK } from "../../../decks/[deckId]/+server";
import { createChatRoom, resetChatRoomStoreForTests } from "$lib/server/chatRoomStore";
import { resetDeckStoreForTests } from "$lib/server/deckStore";

// LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20): POST/PATCH/DELETE now
// require chatRoomAuthGate. Default tests supply admin Bearer; 401-unauth
// cases use withAuth:false.
const ADMIN_TOKEN_FOR_TESTS = 'decks-route-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});
afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
});

type AnyEvent = Parameters<typeof GET>[0];

function eventFor(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  roomId: string,
  search = "",
  body?: unknown,
  withAuth = true
) {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/decks${search}`);
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (withAuth) headers.authorization = `Bearer ${ADMIN_TOKEN_FOR_TESTS}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = new Request(url.toString(), init);
  return { request, params: { roomId }, url } as unknown as AnyEvent;
}

function invalidJsonEvent(method: "POST" | "PATCH", roomId: string, search = "") {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/decks${search}`);
  const request = new Request(url.toString(), {
    method,
    body: "{",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}`
    }
  });
  return { request, params: { roomId }, url } as unknown as AnyEvent;
}

function publicDeckEvent(deckId: string, search = "") {
  const url = new URL(`http://localhost/api/decks/${deckId}${search}`);
  return { request: new Request(url.toString()), params: { deckId }, url } as unknown as AnyEvent;
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

describe("/api/chat-rooms/:roomId/decks", () => {
  beforeEach(() => {
    resetDeckStoreForTests();
    resetChatRoomStoreForTests();
  });

  it("GET 404s when the room does not exist", async () => {
    const response = await runHandler(GET, eventFor("GET", "ghost"));
    expect(response.status).toBe(404);
  });

  it("GET returns empty array for room with no decks", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const response = await runHandler(GET, eventFor("GET", room.id));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.decks).toEqual([]);
  });

  it("POST creates a deck and GET lists it", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const postRes = await runHandler(POST, eventFor("POST", room.id, "", { title: "Pitch", slides: [{ id: "s1", title: "Intro", content: "Hello" }], accessPassword: "hunter2" }));
    expect(postRes.status).toBe(201);
    const created = await postRes.json();
    expect(created.title).toBe("Pitch");
    expect(created.accessPassword).toBeUndefined();

    const getRes = await runHandler(GET, eventFor("GET", room.id));
    const body = await getRes.json();
    expect(body.decks.length).toBe(1);
    expect(body.decks[0].title).toBe("Pitch");
    expect(body.decks[0].accessPassword).toBeUndefined();
  });

  it("POST rejects missing title", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const res = await runHandler(POST, eventFor("POST", room.id, "", { slides: [] }));
    expect(res.status).toBe(400);
  });

  it("PATCH updates a deck", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const postRes = await runHandler(POST, eventFor("POST", room.id, "", { title: "Old" }));
    const created = await postRes.json();

    const patchRes = await runHandler(PATCH, eventFor("PATCH", room.id, `?deckId=${created.id}`, { title: "New" }));
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.title).toBe("New");
    expect(updated.accessPassword).toBeUndefined();
  });

  it("PATCH updates deck password without leaking it and public GET accepts the new password", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const postRes = await runHandler(POST, eventFor("POST", room.id, "", { title: "Passworded" }));
    const created = await postRes.json();

    const patchRes = await runHandler(PATCH, eventFor("PATCH", room.id, `?deckId=${created.id}`, {
      accessPassword: "new-secret"
    }));
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json();
    expect(updated.accessPassword).toBeUndefined();

    const deniedRes = await runHandler(GET_PUBLIC_DECK as unknown as (event: AnyEvent) => unknown, publicDeckEvent(created.id));
    expect(deniedRes.status).toBe(403);

    const allowedRes = await runHandler(
      GET_PUBLIC_DECK as unknown as (event: AnyEvent) => unknown,
      publicDeckEvent(created.id, "?password=new-secret")
    );
    expect(allowedRes.status).toBe(200);
    const body = await allowedRes.json();
    expect(body.deck.title).toBe("Passworded");
    expect(body.deck.accessPassword).toBeUndefined();
  });

  it("PATCH rejects missing deckId and malformed JSON", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });

    const missingIdRes = await runHandler(PATCH, eventFor("PATCH", room.id, "", { title: "No target" }));
    expect(missingIdRes.status).toBe(400);

    const postRes = await runHandler(POST, eventFor("POST", room.id, "", { title: "Patch target" }));
    const created = await postRes.json();
    const malformedRes = await runHandler(PATCH, invalidJsonEvent("PATCH", room.id, `?deckId=${created.id}`));
    expect(malformedRes.status).toBe(400);
  });

  it("PATCH and DELETE reject decks from another room", async () => {
    const owningRoom = createChatRoom({ name: "owner", whoCreatedIt: "test" });
    const otherRoom = createChatRoom({ name: "other", whoCreatedIt: "test" });
    const postRes = await runHandler(POST, eventFor("POST", owningRoom.id, "", { title: "Private deck" }));
    const created = await postRes.json();

    const patchRes = await runHandler(PATCH, eventFor("PATCH", otherRoom.id, `?deckId=${created.id}`, { title: "Nope" }));
    expect(patchRes.status).toBe(403);

    const deleteRes = await runHandler(DELETE, eventFor("DELETE", otherRoom.id, `?deckId=${created.id}`));
    expect(deleteRes.status).toBe(403);
  });

  it("DELETE soft-deletes a deck", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const postRes = await runHandler(POST, eventFor("POST", room.id, "", { title: "ToDelete" }));
    const created = await postRes.json();

    const delRes = await runHandler(DELETE, eventFor("DELETE", room.id, `?deckId=${created.id}`));
    expect(delRes.status).toBe(204);

    const getRes = await runHandler(GET, eventFor("GET", room.id));
    const body = await getRes.json();
    expect(body.decks).toEqual([]);
  });

  it("DELETE rejects missing deckId", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const res = await runHandler(DELETE, eventFor("DELETE", room.id));
    expect(res.status).toBe(400);
  });

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  it("POST returns 401 when no auth header is provided", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const response = await runHandler(
      POST,
      eventFor("POST", room.id, "", { title: "hijacked" }, false)
    );
    expect(response.status).toBe(401);
  });

  it("PATCH returns 401 when no auth header is provided", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const postRes = await runHandler(POST, eventFor("POST", room.id, "", { title: "target" }));
    const created = await postRes.json();
    const response = await runHandler(
      PATCH,
      eventFor("PATCH", room.id, `?deckId=${created.id}`, { title: "hijacked" }, false)
    );
    expect(response.status).toBe(401);
  });

  it("DELETE returns 401 when no auth header is provided", async () => {
    const room = createChatRoom({ name: "decks-test", whoCreatedIt: "test" });
    const postRes = await runHandler(POST, eventFor("POST", room.id, "", { title: "ToDelete" }));
    const created = await postRes.json();
    const response = await runHandler(
      DELETE,
      eventFor("DELETE", room.id, `?deckId=${created.id}`, undefined, false)
    );
    expect(response.status).toBe(401);
  });
});
