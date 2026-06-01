/**
 * Memory recall — unified search across the surfaces ANT remembers.
 *
 * Slice 1 backend (accepted) aggregates messages + chair digest notes.
 * Slice 3 internal-expansion-prep (this slice) adds agent events + shared
 * files BEHIND an opt-in includeSurfaces param. The endpoint at
 * /api/memory-recall and the /memory UI both keep calling
 * recallAcrossSurfaces({ query, limit }) without includeSurfaces, so they
 * keep getting the original message+note response shape. Slice 4 pairs
 * endpoint opt-in (?surfaces=all) with /memory UI rendering of the new
 * kinds.
 *
 * Type-level compatibility (per @evolveantcodex slice-3 guard):
 *   - Exported RecallHit (message | note) is UNCHANGED from slice 1.
 *     The accepted /memory page imports this type and renders against
 *     it; widening it would break its TypeScript narrowing.
 *   - New type ExtendedRecallHit adds agentEvent + file variants for
 *     slice-3 callers that opt in. recallAcrossSurfaces uses overloads
 *     so the default call (no includeSurfaces) returns RecallHit[] and
 *     the opt-in call returns ExtendedRecallHit[].
 *
 * Cross-surface recency guard (per @evolveantcodex slice-1 approval):
 *   All four surface kinds carry occurredAtMillis derived from their
 *   own ISO timestamp (postedAt / setAt / recordedAt / uploadedAt).
 *   That single number is the only sort key — message.postOrder is
 *   never compared to a note.setAt.
 *
 * Pure consumer of accepted stores — public APIs only, no private map
 * peeking. File hits carry metadata only; contentsBase64 never leaks
 * through this layer.
 */

import { searchMessages, type MessageSearchHit } from './messageSearchStore';
import {
  listDigestNotes,
  findDigestNote,
  type ChairDigestNote
} from './chairDigestNoteStore';
import { listChatRooms, doesChatRoomExist } from './chatRoomStore';
import {
  listAgentEventsInRoom,
  type AgentEvent
} from './agentTimelineStore';
import { listMessagesAfterLatestBreak } from './chatMessageStore';
import {
  listFilesSharedInRoom,
  type SharedFile
} from './chatAttachmentStore';
import {
  listAllOpenAsks,
  listOpenAsksInRoom,
  type Ask
} from './askStore';

const DEFAULT_RECALL_LIMIT = 50;
const HARD_CAP_RECALL_LIMIT = 200;
const MESSAGE_SEARCH_INNER_LIMIT = HARD_CAP_RECALL_LIMIT;

// Slice 4 surface set — what KNOWN_RECALL_KINDS in the endpoint uses.
// /memory UI consumes ExtendedRecallHit which is built from this set.
type RecallKindThroughFile = 'message' | 'note' | 'agentEvent' | 'file';
// Slice 5 adds "ask" as an internal opt-in. The endpoint's
// KNOWN_RECALL_KINDS does NOT include "ask" yet (that lands in slice 6
// as a paired endpoint+UI vertical), so /memory keeps seeing the
// ExtendedRecallHit shape.
export type RecallKind = RecallKindThroughFile | 'ask';

// Slice 1 contract — unchanged. The accepted /memory UI imports this.
export type RecallHit =
  | { kind: 'message'; messageHit: MessageSearchHit; occurredAtMillis: number }
  | { kind: 'note'; noteHit: ChairDigestNote; occurredAtMillis: number };

export type SharedFileMetadata = Omit<SharedFile, 'contentsBase64'>;

// Slice 3 additions for opt-in callers. Not yet consumed by any UI.
export type AgentEventRecallHit = {
  kind: 'agentEvent';
  eventHit: AgentEvent;
  roomId: string;
  roomName: string;
  occurredAtMillis: number;
};

export type FileRecallHit = {
  kind: 'file';
  fileHit: SharedFileMetadata;
  roomId: string;
  roomName: string;
  occurredAtMillis: number;
};

export type AskRecallHit = {
  kind: 'ask';
  askHit: Ask;
  roomId: string;
  roomName: string;
  occurredAtMillis: number;
};

// Slice 4 contract — UNCHANGED in slice 5 so /memory UI TypeChecks unchanged.
export type ExtendedRecallHit = RecallHit | AgentEventRecallHit | FileRecallHit;

// Slice 5 wider type — only returned when caller opts in to "ask".
export type RecallHitIncludingAsks = ExtendedRecallHit | AskRecallHit;

const DEFAULT_INCLUDE_SURFACES: RecallKind[] = ['message', 'note'];

// Overloads keep the public default surface narrow so accepted callers
// (endpoint + /memory UI) continue to see the RecallHit union exactly.
// Slice 5 adds a third overload returning the wider RecallHitIncludingAsks
// only when the caller opts in to "ask" via includeSurfaces. Slice 7 adds
// optional roomId scoping to every overload — default (no roomId) returns
// exactly the same shape as before (zero-drift), passing a roomId scopes
// every surface to that room before the cross-kind merge/sort.
export function recallAcrossSurfaces(input: {
  query: string;
  limit?: number;
  roomId?: string;
  afterLatestBreakOnly?: boolean;
}): RecallHit[];
export function recallAcrossSurfaces(input: {
  query: string;
  limit?: number;
  roomId?: string;
  afterLatestBreakOnly?: boolean;
  includeSurfaces: RecallKindThroughFile[];
}): ExtendedRecallHit[];
export function recallAcrossSurfaces(input: {
  query: string;
  limit?: number;
  roomId?: string;
  afterLatestBreakOnly?: boolean;
  includeSurfaces: RecallKind[];
}): RecallHitIncludingAsks[];
export function recallAcrossSurfaces(input: {
  query: string;
  limit?: number;
  roomId?: string;
  afterLatestBreakOnly?: boolean;
  includeSurfaces?: RecallKind[];
}): RecallHit[] | ExtendedRecallHit[] | RecallHitIncludingAsks[] {
  const trimmedQuery = input.query.trim();
  if (trimmedQuery.length === 0) {
    throw new Error('A recall query needs at least one non-blank character.');
  }

  const effectiveLimit = clampLimit(input.limit);
  const queryInLowercase = trimmedQuery.toLowerCase();
  const includeSet = new Set<RecallKind>(
    input.includeSurfaces ?? DEFAULT_INCLUDE_SURFACES
  );
  const roomIdScope = input.roomId;

  // Slice 7 unknown-roomId guard: when a roomId is provided but no such
  // room exists, recall returns empty hits at the store layer. This is
  // the approved "unknown roomId empty at store layer" semantics from
  // @evolveantcodex slice 7 Option A. doesChatRoomExist is the public
  // API for membership; messageSearchStore throws on unknown roomId so
  // this guard prevents that throw from leaking through recall.
  if (roomIdScope !== undefined && !doesChatRoomExist(roomIdScope)) {
    return [];
  }

  const allHits: RecallHitIncludingAsks[] = [];
  const latestBreakBoundary =
    input.afterLatestBreakOnly === true && roomIdScope !== undefined
      ? latestBreakCutoff(roomIdScope)
      : undefined;

  if (includeSet.has('message')) {
    allHits.push(...recallFromMessages(trimmedQuery, roomIdScope));
  }
  if (includeSet.has('note')) {
    allHits.push(...recallFromNotes(queryInLowercase, roomIdScope));
  }
  if (includeSet.has('agentEvent')) {
    allHits.push(...recallFromAgentEvents(queryInLowercase, roomIdScope));
  }
  if (includeSet.has('file')) {
    allHits.push(...recallFromAttachments(queryInLowercase, roomIdScope));
  }
  if (includeSet.has('ask')) {
    allHits.push(...recallFromAsks(queryInLowercase, roomIdScope));
  }

  const scopedHits =
    latestBreakBoundary === undefined
      ? allHits
      : allHits.filter((hit) => isHitAfterBreakBoundary(hit, latestBreakBoundary));

  scopedHits.sort((a, b) => b.occurredAtMillis - a.occurredAtMillis);
  return scopedHits.slice(0, effectiveLimit);
}

export function resetMemoryRecallStoreForTests(): void {
  // Pure consumer — no internal state of its own.
}

// Slice 7 surface helpers: every helper accepts an optional roomId and
// SCOPES BEFORE returning hits, so the top-level merge/sort/limit only
// sees room-scoped hits when a roomId is set. No-roomId callers see the
// unscoped behaviour exactly as before.

function recallFromMessages(query: string, roomId: string | undefined): RecallHit[] {
  // searchMessages already supports roomId? as a public API.
  const messageHits = searchMessages({
    query,
    roomId,
    limit: MESSAGE_SEARCH_INNER_LIMIT
  });
  return messageHits.map((hit) => ({
    kind: 'message',
    messageHit: hit,
    occurredAtMillis: occurredAtMillisFor(hit.message.postedAt)
  }));
}

function recallFromNotes(
  queryInLowercase: string,
  roomId: string | undefined
): RecallHit[] {
  // findDigestNote is the public API for room-scoped lookup; unknown
  // roomId yields no note and recall surfaces empty hits for that kind.
  const notesToScan =
    roomId === undefined
      ? listDigestNotes()
      : (() => {
          const noteForRoom = findDigestNote(roomId);
          return noteForRoom ? [noteForRoom] : [];
        })();
  return notesToScan
    .filter((note) => note.noteText.toLowerCase().includes(queryInLowercase))
    .map((note) => ({
      kind: 'note',
      noteHit: note,
      occurredAtMillis: occurredAtMillisFor(note.setAt)
    }));
}

function recallFromAgentEvents(
  queryInLowercase: string,
  roomId: string | undefined
): AgentEventRecallHit[] {
  const allHits: AgentEventRecallHit[] = [];
  const roomsInScope =
    roomId === undefined
      ? listChatRooms()
      : listChatRooms().filter((room) => room.id === roomId);
  for (const room of roomsInScope) {
    const events = listAgentEventsInRoom(room.id);
    for (const event of events) {
      if (event.summary.toLowerCase().includes(queryInLowercase)) {
        allHits.push({
          kind: 'agentEvent',
          eventHit: event,
          roomId: room.id,
          roomName: room.name,
          occurredAtMillis: occurredAtMillisFor(event.recordedAt)
        });
      }
    }
  }
  return allHits;
}

function recallFromAttachments(
  queryInLowercase: string,
  roomId: string | undefined
): FileRecallHit[] {
  const allHits: FileRecallHit[] = [];
  const roomsInScope =
    roomId === undefined
      ? listChatRooms()
      : listChatRooms().filter((room) => room.id === roomId);
  for (const room of roomsInScope) {
    const filesInRoom = listFilesSharedInRoom(room.id);
    for (const file of filesInRoom) {
      if (file.filename.toLowerCase().includes(queryInLowercase)) {
        // File hits stay metadata-only — contentsBase64 is stripped
        // structurally before leaving this layer (slice 5 guard).
        const { contentsBase64: _unused, ...metadata } = file;
        allHits.push({
          kind: 'file',
          fileHit: metadata,
          roomId: room.id,
          roomName: room.name,
          occurredAtMillis: occurredAtMillisFor(file.uploadedAt)
        });
      }
    }
  }
  return allHits;
}

function recallFromAsks(
  queryInLowercase: string,
  roomId: string | undefined
): AskRecallHit[] {
  // Slice 7 ask scoping: when roomId is set, listOpenAsksInRoom yields
  // only the open asks for that room. When absent, listAllOpenAsks yields
  // every open ask globally. Both APIs filter status=open, so
  // answered/dismissed asks remain excluded from recall by construction
  // (slice 5 contract guard from @evolveantcodex). Match against title
  // OR body, case-insensitive.
  const roomNameById = new Map<string, string>();
  for (const room of listChatRooms()) {
    roomNameById.set(room.id, room.name);
  }
  const asksToScan =
    roomId === undefined ? listAllOpenAsks() : listOpenAsksInRoom(roomId);
  const allHits: AskRecallHit[] = [];
  for (const ask of asksToScan) {
    const titleMatch = ask.title.toLowerCase().includes(queryInLowercase);
    const bodyMatch = ask.body.toLowerCase().includes(queryInLowercase);
    if (titleMatch || bodyMatch) {
      allHits.push({
        kind: 'ask',
        askHit: ask,
        roomId: ask.roomId,
        roomName: roomNameById.get(ask.roomId) ?? ask.roomId,
        occurredAtMillis: occurredAtMillisFor(ask.openedAt)
      });
    }
  }
  return allHits;
}

function occurredAtMillisFor(isoTimestamp: string): number {
  const millis = new Date(isoTimestamp).getTime();
  if (Number.isNaN(millis)) return 0;
  return millis;
}

function latestBreakCutoff(roomId: string): { postOrder: number; occurredAtMillis: number } | undefined {
  const currentContext = listMessagesAfterLatestBreak(roomId);
  const boundary = currentContext[0];
  if (!boundary || boundary.kind !== 'system-break') return undefined;
  return {
    postOrder: boundary.postOrder,
    occurredAtMillis: occurredAtMillisFor(boundary.postedAt)
  };
}

function isHitAfterBreakBoundary(
  hit: RecallHitIncludingAsks,
  boundary: { postOrder: number; occurredAtMillis: number }
): boolean {
  if (hit.kind === 'message') return hit.messageHit.message.postOrder >= boundary.postOrder;
  return hit.occurredAtMillis >= boundary.occurredAtMillis;
}

function clampLimit(rawLimit: number | undefined): number {
  if (rawLimit === undefined) return DEFAULT_RECALL_LIMIT;
  if (!Number.isFinite(rawLimit) || rawLimit <= 0) return DEFAULT_RECALL_LIMIT;
  return Math.min(Math.floor(rawLimit), HARD_CAP_RECALL_LIMIT);
}
