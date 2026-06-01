/**
 * terminalPromptEventStore — Task #114 prompt-bridge minimum viable.
 *
 * Records "I need a response" events surfaced by a terminal/agent so
 * the room can answer them in one place. Status flow:
 *   pending → responded   (human or peer agent replied)
 *   pending → dismissed   (operator marked irrelevant)
 *
 * The v3 broker layer (multi-target delivery, pattern config, webhook
 * fan-out) is intentionally out of v1; storage + read/mark are enough
 * to unblock the room UI.
 */

import { randomUUID } from 'node:crypto';
import { getIdentityDb } from './db';

export type PromptEventStatus = 'pending' | 'responded' | 'dismissed';

export type TerminalPromptEvent = {
  id: string;
  terminalId: string | null;
  roomId: string | null;
  rawText: string;
  detector: string | null;
  detectedAtMs: number;
  status: PromptEventStatus;
  respondedAtMs: number | null;
};

type PromptEventRow = {
  id: string;
  terminal_id: string | null;
  room_id: string | null;
  raw_text: string;
  detector: string | null;
  detected_at_ms: number;
  status: PromptEventStatus;
  responded_at_ms: number | null;
};

function rowToEvent(row: PromptEventRow): TerminalPromptEvent {
  return {
    id: row.id,
    terminalId: row.terminal_id,
    roomId: row.room_id,
    rawText: row.raw_text,
    detector: row.detector,
    detectedAtMs: row.detected_at_ms,
    status: row.status,
    respondedAtMs: row.responded_at_ms
  };
}

export function recordPromptEvent(input: {
  terminalId?: string | null;
  roomId?: string | null;
  rawText: string;
  detector?: string | null;
  nowMs?: number;
}): TerminalPromptEvent {
  const trimmedText = input.rawText.trim();
  if (trimmedText.length === 0) {
    throw new Error('rawText cannot be blank.');
  }
  const id = randomUUID();
  const detectedAtMs = input.nowMs ?? Date.now();
  getIdentityDb()
    .prepare(
      `INSERT INTO terminal_prompt_events
       (id, terminal_id, room_id, raw_text, detector, detected_at_ms, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`
    )
    .run(
      id,
      input.terminalId ?? null,
      input.roomId ?? null,
      trimmedText,
      input.detector ?? null,
      detectedAtMs
    );
  return {
    id,
    terminalId: input.terminalId ?? null,
    roomId: input.roomId ?? null,
    rawText: trimmedText,
    detector: input.detector ?? null,
    detectedAtMs,
    status: 'pending',
    respondedAtMs: null
  };
}

export function listPendingPromptsInRoom(roomId: string): TerminalPromptEvent[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, terminal_id, room_id, raw_text, detector, detected_at_ms, status, responded_at_ms
         FROM terminal_prompt_events
        WHERE room_id = ? AND status = 'pending'
        ORDER BY detected_at_ms DESC`
    )
    .all(roomId) as PromptEventRow[];
  return rows.map(rowToEvent);
}

export function listPromptsForTerminal(terminalId: string): TerminalPromptEvent[] {
  const rows = getIdentityDb()
    .prepare(
      `SELECT id, terminal_id, room_id, raw_text, detector, detected_at_ms, status, responded_at_ms
         FROM terminal_prompt_events
        WHERE terminal_id = ?
        ORDER BY detected_at_ms DESC`
    )
    .all(terminalId) as PromptEventRow[];
  return rows.map(rowToEvent);
}

export function markPromptStatus(
  promptId: string,
  nextStatus: Exclude<PromptEventStatus, 'pending'>,
  nowMs?: number
): boolean {
  const respondedAtMs = nowMs ?? Date.now();
  const result = getIdentityDb()
    .prepare(
      `UPDATE terminal_prompt_events
          SET status = ?, responded_at_ms = ?
        WHERE id = ? AND status = 'pending'`
    )
    .run(nextStatus, respondedAtMs, promptId);
  return result.changes > 0;
}

export function resetTerminalPromptEventStoreForTests(): void {
  getIdentityDb().prepare(`DELETE FROM terminal_prompt_events`).run();
}
