/**
 * In-memory store of per-room agent activity events.
 *
 * Backs M16 agent-timeline slice 1 (wireframe board W2Yo0T). Slice 1 is
 * backend + standalone components only; slotting into the room view lands
 * in a follow-up slice once @claude2 slice 5 closes and +page.svelte is
 * stable.
 *
 * Events recorded here describe what agents are DOING — tool calls they
 * fired, status transitions they moved through, plan-mode entries they
 * opened, ask-user-question payloads they emitted. Every event has an
 * authorHandle so the timeline can group by agent or read chronologically.
 *
 * Pure in-memory Map for now. Persistence lands in the same milestone that
 * persists chat messages.
 */

export type AgentEventKind =
  | 'tool-call'
  | 'status-transition'
  | 'plan-mode-entered'
  | 'plan-mode-exited'
  | 'ask-user-question';

export type AgentEvent = {
  id: string;
  roomId: string;
  authorHandle: string;
  authorDisplayName: string;
  kind: AgentEventKind;
  summary: string;
  details?: Record<string, unknown>;
  recordedAt: string;
  sequence: number;
};

const eventsByRoomId = new Map<string, AgentEvent[]>();
let nextSequenceNumber = 1;

function makeEventId(): string {
  const four = Math.random().toString(36).slice(2, 6);
  const six = Math.random().toString(36).slice(2, 8);
  return `ev_${four}${six}`;
}

function eventListForRoom(roomId: string): AgentEvent[] {
  const existing = eventsByRoomId.get(roomId);
  if (existing) return existing;
  const fresh: AgentEvent[] = [];
  eventsByRoomId.set(roomId, fresh);
  return fresh;
}

export type RecordAgentEventInput = {
  roomId: string;
  authorHandle: string;
  authorDisplayName?: string;
  kind: AgentEventKind;
  summary: string;
  details?: Record<string, unknown>;
};

export function recordAgentEvent(input: RecordAgentEventInput): AgentEvent {
  const trimmedSummary = input.summary.trim();
  if (trimmedSummary.length === 0) {
    throw new Error('An agent event needs a non-blank summary.');
  }
  const trimmedAuthorHandle = input.authorHandle.trim();
  if (trimmedAuthorHandle.length === 0) {
    throw new Error('An agent event needs a non-blank authorHandle.');
  }

  const newEvent: AgentEvent = {
    id: makeEventId(),
    roomId: input.roomId,
    authorHandle: trimmedAuthorHandle,
    authorDisplayName: input.authorDisplayName?.trim() || trimmedAuthorHandle,
    kind: input.kind,
    summary: trimmedSummary,
    details: input.details,
    recordedAt: new Date().toISOString(),
    sequence: nextSequenceNumber
  };

  nextSequenceNumber = nextSequenceNumber + 1;
  eventListForRoom(input.roomId).push(newEvent);
  return newEvent;
}

export function listAgentEventsInRoom(roomId: string): AgentEvent[] {
  return eventListForRoom(roomId)
    .slice()
    .sort((leftEvent, rightEvent) => leftEvent.sequence - rightEvent.sequence);
}

export function resetAgentTimelineStoreForTests(): void {
  eventsByRoomId.clear();
  nextSequenceNumber = 1;
}
