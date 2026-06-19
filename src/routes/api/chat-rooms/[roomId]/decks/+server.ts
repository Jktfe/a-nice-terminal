/**
 * GET    /api/chat-rooms/:roomId/decks          list non-deleted decks
 * POST   /api/chat-rooms/:roomId/decks          create one deck
 * PATCH  /api/chat-rooms/:roomId/decks?deckId=  update deck
 * DELETE /api/chat-rooms/:roomId/decks?deckId=  soft-delete
 *
 * Backs Task #126 decks subsystem: room-scoped slide decks.
 */

import { error, json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";
import { findChatRoomById } from "$lib/server/chatRoomStore";
import {
  createDeck,
  listDecksInRoom,
  getDeck,
  updateDeck,
  softDeleteDeck
} from "$lib/server/deckStore";
import { serializeDeckForApi } from "$lib/server/deckApi";
import { requireChatRoomMutationAuth } from "$lib/server/chatRoomAuthGate";
import { requireChatRoomReadAccess } from "$lib/server/chatRoomReadGate";
import { deckThemeForSubstrate } from "$lib/externalDeckSubstrate";

export const GET: RequestHandler = async ({ params, request }) => {
  const room = findChatRoomById(params.roomId);
  if (!room) throw error(404, "Room not found.");
  await requireChatRoomReadAccess(request, room);
  return json({ decks: listDecksInRoom(params.roomId).map(serializeDeckForApi) });
};

export const POST: RequestHandler = async ({ params, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, "Room not found.");
  const payload = (await request.json().catch(() => null)) as
    | { title?: unknown; slides?: unknown; theme?: unknown; animotionSlug?: unknown; openSlideSlug?: unknown; createdBy?: unknown; accessPassword?: unknown; parentDeckId?: unknown; voicePresetId?: unknown }
    | null;
  if (!payload) throw error(400, "JSON body required.");

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  const auth = requireChatRoomMutationAuth(params.roomId, request, payload);

  if (typeof payload.title !== "string" || payload.title.trim().length === 0) {
    throw error(400, "title is required.");
  }

  // Auth-vs-target anti-spoof (UX harness ddc44e8 GAP-4a, 2026-05-20):
  // caller cannot stamp a deck with someone else's createdBy. If a body
  // value is supplied it must match the resolved caller; admin-bearer
  // bypass for operator/CI tooling. When no createdBy is supplied we
  // fall back to the resolved caller (server-trusted).
  const requestedCreatedBy = typeof payload.createdBy === "string" ? payload.createdBy : undefined;
  if (requestedCreatedBy !== undefined && !auth.isAdminBearer && auth.handle !== requestedCreatedBy) {
    throw error(403, `caller ${auth.handle} cannot create deck as ${requestedCreatedBy}`);
  }
  const createdBy = requestedCreatedBy ?? auth.handle;

  let theme = typeof payload.theme === "string" ? payload.theme : null;
  if (payload.animotionSlug !== undefined && payload.openSlideSlug !== undefined) {
    throw error(400, "Provide only one deck substrate slug.");
  }
  if (payload.animotionSlug !== undefined) {
    if (typeof payload.animotionSlug !== "string") throw error(400, "animotionSlug must be a string.");
    try {
      theme = deckThemeForSubstrate('animotion', payload.animotionSlug);
    } catch {
      throw error(400, "animotionSlug is invalid.");
    }
  }
  if (payload.openSlideSlug !== undefined) {
    if (typeof payload.openSlideSlug !== "string") throw error(400, "openSlideSlug must be a string.");
    try {
      theme = deckThemeForSubstrate('open-slide', payload.openSlideSlug);
    } catch {
      throw error(400, "openSlideSlug is invalid.");
    }
  }

  const slides = Array.isArray(payload.slides) ? payload.slides : undefined;
  let deck;
  try {
    deck = createDeck({
      roomId: params.roomId,
      title: payload.title,
      slides,
      theme,
      createdBy,
      accessPassword: typeof payload.accessPassword === "string" ? payload.accessPassword : null,
      parentDeckId: typeof payload.parentDeckId === "string" ? payload.parentDeckId : null,
      voicePresetId: typeof payload.voicePresetId === "string" ? payload.voicePresetId : null
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes("voice preset not found")) throw error(400, "voicePresetId was not found.");
    throw cause;
  }
  return json(serializeDeckForApi(deck), { status: 201 });
};

export const PATCH: RequestHandler = async ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, "Room not found.");
  const deckId = url.searchParams.get("deckId");
  if (!deckId) throw error(400, "deckId query parameter required.");

  const payload = (await request.json().catch(() => null)) as
    | { title?: unknown; slides?: unknown; theme?: unknown; accessPassword?: unknown; voicePresetId?: unknown }
    | null;
  if (!payload) throw error(400, "JSON body required.");

  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  requireChatRoomMutationAuth(params.roomId, request, payload);

  const existing = getDeck(deckId);
  if (!existing) throw error(404, "Deck not found.");
  if (existing.roomId !== params.roomId) {
    throw error(403, "Deck does not belong to this room.");
  }

  let updated;
  try {
    updated = updateDeck(deckId, {
      title: typeof payload.title === "string" ? payload.title : undefined,
      slides: Array.isArray(payload.slides) ? payload.slides : undefined,
      theme: payload.theme !== undefined ? (typeof payload.theme === "string" ? payload.theme : null) : undefined,
      accessPassword: payload.accessPassword !== undefined ? (typeof payload.accessPassword === "string" ? payload.accessPassword : null) : undefined,
      voicePresetId: payload.voicePresetId !== undefined ? (typeof payload.voicePresetId === "string" ? payload.voicePresetId : null) : undefined
    });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    if (message.includes("voice preset not found")) throw error(400, "voicePresetId was not found.");
    throw cause;
  }
  if (!updated) throw error(404, "Deck not found.");
  return json(serializeDeckForApi(updated));
};

export const DELETE: RequestHandler = ({ params, url, request }) => {
  if (!findChatRoomById(params.roomId)) throw error(404, "Room not found.");
  // LAUNCH-BLOCKER CVE FIX C (Finding #3, 2026-05-20)
  requireChatRoomMutationAuth(params.roomId, request, null);
  const deckId = url.searchParams.get("deckId");
  if (!deckId) throw error(400, "deckId query parameter required.");

  const existing = getDeck(deckId);
  if (!existing) throw error(404, "Deck not found.");
  if (existing.roomId !== params.roomId) {
    throw error(403, "Deck does not belong to this room.");
  }

  const removed = softDeleteDeck(deckId);
  if (!removed) throw error(404, "Deck not found.");
  return new Response(null, { status: 204 });
};
