/**
 * Unified recall across the surfaces ANT remembers.
 *
 *   GET /api/memory-recall?query=...[&limit=...][&surfaces=...][&roomId=...]
 *     → 200 { hits: ... }   newest first, capped to limit
 *     → 400                 query missing or blank
 *     → 404                 roomId provided but no such room exists
 *
 * Surface selection (slices 4 + 6):
 *   - surfaces missing OR "default" OR whitespace-only → preserves the
 *     accepted slice-1 contract exactly: response carries only message
 *     and note hits.
 *   - surfaces=all → includes all five kinds (message + note +
 *     agentEvent + file + ask).  Slice 6 adds "ask" alongside the
 *     existing four; ask hits are open-asks only (answered/dismissed
 *     are excluded by the slice 5 store guard).
 *   - surfaces=message,ask → comma-separated subset. Each element is
 *     trimmed; unknown kinds are silently dropped per the slice-3
 *     store guard. If filtering leaves no known kinds, the request
 *     falls back to the default message+note contract (no implicit
 *     widening on garbage input).
 *
 * Room scoping (slice 8 — public endpoint exposure of slice 7 store):
 *   - roomId missing OR whitespace-only → unscoped (zero-drift default
 *     contract: response shape and selection unchanged from prior
 *     callers).
 *   - roomId non-empty after trim AND room exists → scoped to that
 *     room across every surface BEFORE the cross-kind merge/sort/limit
 *     (the store enforces scope-before-merge per slice 7 baseline).
 *   - roomId non-empty after trim AND room does NOT exist → 404 "Room
 *     not found." (mirrors /api/asks?roomId convention).
 *
 * Break scoping (long-memory toggle):
 *   - longMemory=1/true/on AND roomId set → search the full room.
 *   - longMemory missing/false AND roomId set → constrain results to
 *     hits after the latest system-break boundary in that room.
 *   - no roomId → global search is unchanged.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  recallAcrossSurfaces,
  type RecallKind
} from '$lib/server/memoryRecallStore';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';

const KNOWN_RECALL_KINDS: readonly RecallKind[] = [
  'message',
  'note',
  'agentEvent',
  'file',
  'ask'
];

export const GET: RequestHandler = ({ url }) => {
  const rawQuery = url.searchParams.get('query');
  if (rawQuery === null || rawQuery.trim().length === 0) {
    throw error(400, 'query parameter required.');
  }

  const limit = parseLimitParam(url.searchParams.get('limit'));
  const includeSurfaces = parseSurfacesParam(url.searchParams.get('surfaces'));
  const roomIdScope = parseRoomIdParam(url.searchParams.get('roomId'));
  const longMemoryEnabled = parseBooleanParam(url.searchParams.get('longMemory'));
  const afterLatestBreakOnly = roomIdScope !== undefined && !longMemoryEnabled;

  // Slice 8 unknown-room guard: when a non-blank roomId is provided but
  // no such room exists, the public endpoint returns 404. Mirrors the
  // /api/asks?roomId convention. The store-layer doesChatRoomExist
  // guard from slice 7 also returns empty internally, but the public
  // contract is explicit 404 so clients can distinguish "no matches in
  // this room" from "this room doesn't exist".
  if (roomIdScope !== undefined && !doesChatRoomExist(roomIdScope)) {
    throw error(404, 'Room not found.');
  }

  try {
    const hits =
      includeSurfaces === undefined
        ? recallAcrossSurfaces({
            query: rawQuery,
            limit,
            roomId: roomIdScope,
            afterLatestBreakOnly
          })
        : recallAcrossSurfaces({
            query: rawQuery,
            limit,
            includeSurfaces,
            roomId: roomIdScope,
            afterLatestBreakOnly
          });
    return json({ hits, longMemory: longMemoryEnabled });
  } catch (causeOfFailure) {
    const reason =
      causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not recall.';
    throw error(400, reason);
  }
};

function parseLimitParam(rawLimit: string | null): number | undefined {
  if (rawLimit === null) return undefined;
  const parsedNumber = Number(rawLimit);
  if (!Number.isFinite(parsedNumber)) return undefined;
  return parsedNumber;
}

function parseBooleanParam(rawValue: string | null): boolean {
  if (rawValue === null) return false;
  const normalized = rawValue.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'on' || normalized === 'yes';
}

function parseRoomIdParam(rawRoomId: string | null): string | undefined {
  // Whitespace-only or missing → undefined → unscoped (zero-drift).
  // Non-empty after trim → forward the trimmed value to the store; the
  // existence check happens above this in the request handler.
  if (rawRoomId === null) return undefined;
  const trimmed = rawRoomId.trim();
  if (trimmed.length === 0) return undefined;
  return trimmed;
}

function parseSurfacesParam(rawSurfaces: string | null): RecallKind[] | undefined {
  if (rawSurfaces === null) return undefined;
  const trimmed = rawSurfaces.trim();
  if (trimmed.length === 0 || trimmed === 'default') return undefined;
  if (trimmed === 'all') return [...KNOWN_RECALL_KINDS];

  const requestedRaw = trimmed.split(',').map((token) => token.trim());
  const filtered = requestedRaw.filter((token): token is RecallKind =>
    (KNOWN_RECALL_KINDS as readonly string[]).includes(token)
  );
  // Garbage-only input falls back to the accepted default contract rather
  // than widening the response with an empty include list.
  return filtered.length > 0 ? filtered : undefined;
}
