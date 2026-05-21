/**
 * remoteEventStore — every cross-bridge message per the M4 Remote ANT
 * design contract (2026-05-13).
 *
 * Schema (see ./db.ts): chat_remote_events
 *
 * Behaviour:
 *   - appendEvent stores accepted events; if the (mapping_id,
 *     replay_signature) UNIQUE constraint trips, the event is stored
 *     instead with status=quarantined (deterministic replay quarantine).
 *     Per contract Q5, status enum is accepted | quarantined ONLY —
 *     reject decisions are no-store and live in the route layer
 *     (returns 4xx).
 *   - markAck sets ack_at_ms on a stored event (operator clears
 *     quarantine after manual review).
 *   - listQuarantineForMapping + listQuarantineAll return quarantined
 *     events newest-first.
 *   - listForMapping returns recent events newest-first (any status).
 *
 * Payload size limit (64KB per contract Q2) is enforced at the route
 * layer before this store is called — the route maps oversized to a
 * 400 reject (no-store) before reaching here.
 */
import { getIdentityDb } from './db';
import { mintTokenSecret } from './chatInviteStore';

export type EventDirection = 'in' | 'out';
export type EventStatus = 'accepted' | 'quarantined';
export type DeliveryState = 'pending' | 'delivered' | 'failed';

export type StoredEvent = {
  id: string;
  mapping_id: string;
  direction: EventDirection;
  kind: string;
  payload_json: string;
  status: EventStatus;
  status_reason: string | null;
  created_at_ms: number;
  ack_at_ms: number | null;
  delivery_state: DeliveryState;
  replay_signature: string;
};

export type AppendEventInput = {
  mappingId: string;
  direction: EventDirection;
  kind: string;
  payloadJson: string;
  replaySignature: string;
};

export type AppendEventResult = {
  event: StoredEvent;
  wasQuarantined: boolean;
};

function newEventId(): string {
  return `evt_${mintTokenSecret().slice(0, 16)}`;
}

function rowToEvent(row: Record<string, unknown>): StoredEvent {
  return {
    id: row.id as string,
    mapping_id: row.mapping_id as string,
    direction: row.direction as EventDirection,
    kind: row.kind as string,
    payload_json: row.payload_json as string,
    status: row.status as EventStatus,
    status_reason: (row.status_reason as string | null) ?? null,
    created_at_ms: row.created_at_ms as number,
    ack_at_ms: (row.ack_at_ms as number | null) ?? null,
    delivery_state: row.delivery_state as DeliveryState,
    replay_signature: row.replay_signature as string
  };
}

export function appendEvent(input: AppendEventInput): AppendEventResult {
  const db = getIdentityDb();
  const now = Date.now();
  const existing = db.prepare(`SELECT id FROM chat_remote_events
    WHERE mapping_id = ? AND replay_signature = ?`).get(input.mappingId, input.replaySignature) as
    Record<string, unknown> | undefined;

  const status: EventStatus = existing ? 'quarantined' : 'accepted';
  const statusReason = existing ? 'replay_collision' : null;
  // For quarantined replays we still write a row, but use a fresh
  // replay_signature suffix so the UNIQUE constraint doesn't trip
  // again. The original replay_signature is preserved in status_reason
  // semantics via the (mapping_id, replay_signature) tuple of the
  // pre-existing row.
  const storedReplay = existing
    ? `${input.replaySignature}::dup-${now}`
    : input.replaySignature;

  const event: StoredEvent = {
    id: newEventId(),
    mapping_id: input.mappingId,
    direction: input.direction,
    kind: input.kind,
    payload_json: input.payloadJson,
    status,
    status_reason: statusReason,
    created_at_ms: now,
    ack_at_ms: null,
    delivery_state: 'pending',
    replay_signature: storedReplay
  };
  db.prepare(`INSERT INTO chat_remote_events
    (id, mapping_id, direction, kind, payload_json, status, status_reason,
     created_at_ms, ack_at_ms, delivery_state, replay_signature)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 'pending', ?)`).run(
    event.id, event.mapping_id, event.direction, event.kind, event.payload_json,
    event.status, event.status_reason, event.created_at_ms, event.replay_signature
  );
  return { event, wasQuarantined: status === 'quarantined' };
}

export function markAck(eventId: string): boolean {
  const db = getIdentityDb();
  const now = Date.now();
  const result = db.prepare(`UPDATE chat_remote_events
    SET ack_at_ms = ? WHERE id = ? AND ack_at_ms IS NULL`).run(now, eventId);
  return result.changes === 1;
}

export function markDelivered(eventId: string): boolean {
  const db = getIdentityDb();
  const result = db.prepare(`UPDATE chat_remote_events
    SET delivery_state = 'delivered' WHERE id = ? AND delivery_state = 'pending'`).run(eventId);
  return result.changes === 1;
}

export function listForMapping(mappingId: string, limit: number = 100): StoredEvent[] {
  const db = getIdentityDb();
  const rows = db.prepare(`SELECT * FROM chat_remote_events
    WHERE mapping_id = ?
    ORDER BY created_at_ms DESC
    LIMIT ?`).all(mappingId, limit) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export function listQuarantineForMapping(mappingId: string): StoredEvent[] {
  const db = getIdentityDb();
  const rows = db.prepare(`SELECT * FROM chat_remote_events
    WHERE mapping_id = ? AND status = 'quarantined'
    ORDER BY created_at_ms DESC`).all(mappingId) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export type CountsByMapping = {
  accepted: number;
  quarantined: number;
  delivered: number;
  pending: number;
  failed: number;
};

export function countsByMappingId(mappingId: string): CountsByMapping {
  const db = getIdentityDb();
  const counts: CountsByMapping = { accepted: 0, quarantined: 0, delivered: 0, pending: 0, failed: 0 };
  const statusRows = db.prepare(`SELECT status, COUNT(*) as n FROM chat_remote_events
    WHERE mapping_id = ? GROUP BY status`).all(mappingId) as { status: EventStatus; n: number }[];
  for (const r of statusRows) counts[r.status] = r.n;
  const deliveryRows = db.prepare(`SELECT delivery_state, COUNT(*) as n FROM chat_remote_events
    WHERE mapping_id = ? GROUP BY delivery_state`).all(mappingId) as { delivery_state: DeliveryState; n: number }[];
  for (const r of deliveryRows) counts[r.delivery_state] = r.n;
  return counts;
}

export function listQuarantineAll(limit: number = 100): StoredEvent[] {
  const db = getIdentityDb();
  const rows = db.prepare(`SELECT * FROM chat_remote_events
    WHERE status = 'quarantined'
    ORDER BY created_at_ms DESC
    LIMIT ?`).all(limit) as Record<string, unknown>[];
  return rows.map(rowToEvent);
}

export function findById(eventId: string): StoredEvent | null {
  const db = getIdentityDb();
  const row = db.prepare(`SELECT * FROM chat_remote_events WHERE id = ?`).get(eventId) as
    Record<string, unknown> | undefined;
  return row ? rowToEvent(row) : null;
}
