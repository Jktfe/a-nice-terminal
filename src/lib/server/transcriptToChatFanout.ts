/**
 * transcriptToChatFanout — closes the Chat-view gap diagnosed 2026-05-21.
 *
 * Per JWPK: "On the chat visual — the reply isn't showing... ANT sort of
 * works as a view... but yeah, that's not what we were shooting for."
 *
 * Symptom: user types into TerminalChatView composer →
 *   1. POST /api/terminals/[id]/agent-launch → PTY ✓ + posts user msg to chat ✓
 *   2. Local agent (pi/claude/codex/qwen/gemini/copilot) runs + writes its
 *      transcript JSONL ✓
 *   3. ingest<Cli>TranscriptLine writes events to terminal_run_events ✓
 *   4. GAP: nothing posts the assistant's reply as a chat-room message → SSE
 *      doesn't push it to Chat view → conversation looks one-sided.
 *
 * TerminalChatView is locked to PATH A: "terminal chat IS the terminal-scoped
 * chat-room dialogue, NOT a kind=message filter over run-events." So we must
 * post transcript-derived 'message' events into chat_messages from the
 * transcript-tail ingestion path — clean, trust=high content only.
 *
 * Contrast with the rolled-back terminalReplyRouter (T2-ROUTING-ROLLBACK
 * 2026-05-15): that path debounced noisy PTY chunks via regex and was
 * intentionally unwired. This helper rides on the CLEAN transcript JSONL
 * stream — no debounce, no noise filters, trust=high straight through.
 *
 * Idempotency: transcript_chat_idempotency table is keyed by
 *   (terminal_id, transcript_event_id). Re-ingesting the same JSONL line on
 *   restart will NOT double-post into the linked chat room. The same
 *   transcriptEventKey passed to appendTerminalRunEvent is the dedupe key.
 *
 * Failure mode: helper is fail-silent — chat-room post errors MUST NOT
 * break transcript ingestion. The transcript-tail caller wraps its
 * appendTerminalRunEvent + broadcast in a try-block; this helper does its
 * own try/catch so a broken room doesn't poison the transcript feed.
 */

import { getIdentityDb } from './db';
import { getTerminalRecord, deriveHandle } from './terminalRecordsStore';
import { findChatRoomById } from './chatRoomStore';
import { postMessage } from './chatMessageStore';
import { broadcastToRoom } from './eventBroadcast';
import type { ClassifiedKind } from './classifiers/types';

export type FanoutArgs = {
  terminalSessionId: string;
  /** transcriptEventKey for this event — required for dedupe. */
  transcriptEventId: string;
  kind: ClassifiedKind;
  text: string;
  /** Optional override; defaults to deriveHandle(terminalRecord). */
  derivedHandle?: string;
};

/**
 * Fan a transcript-derived event into the terminal's linked chat room.
 * Returns true when a NEW chat_messages row was inserted, false in every
 * other case (kind!='message', no link, dedup hit, error swallowed, etc.).
 */
export function fanoutMessageToLinkedChatRoom(args: FanoutArgs): boolean {
  // Only assistant prose belongs in chat. User commands are already in the
  // room via the /agent-launch route; tool_call / thinking / raw stay in
  // ANT-view only (JWPK 2026-05-21 framing: cd-class captured, verbose not).
  if (args.kind !== 'message') return false;
  const text = (args.text ?? '').trim();
  if (text.length === 0) return false;
  if (!args.transcriptEventId) return false;

  try {
    const record = getTerminalRecord(args.terminalSessionId);
    if (!record) return false;
    const roomId = record.linked_chat_room_id;
    if (!roomId) return false;
    if (!findChatRoomById(roomId)) return false;

    const authorHandle = args.derivedHandle ?? deriveHandle(record);
    const db = getIdentityDb();

    // Reserve the dedupe slot. INSERT … OR IGNORE means a second ingest
    // of the same transcript line is a no-op (changes === 0).
    const reserve = db.prepare(
      `INSERT OR IGNORE INTO transcript_chat_idempotency
         (terminal_id, transcript_event_id, chat_message_id, room_id, posted_at_ms)
       VALUES (?, ?, ?, ?, ?)`
    );
    // Placeholder chat_message_id, replaced once postMessage returns. We
    // can't make chat_message_id NULL because the column is NOT NULL — use
    // a sentinel + UPDATE pattern to keep the constraint strict.
    const placeholderId = `pending-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const reserveResult = reserve.run(
      args.terminalSessionId,
      args.transcriptEventId,
      placeholderId,
      roomId,
      Date.now()
    );
    if (reserveResult.changes === 0) {
      // Already fanned out for this transcript line — do nothing.
      return false;
    }

    let newMessage;
    try {
      newMessage = postMessage({
        roomId,
        authorHandle,
        body: text,
        kind: 'agent'
      });
    } catch {
      // postMessage failed — roll back the dedupe slot so a later retry
      // (e.g. the transcript-tail watcher repolling the same line after a
      // transient room misconfig) can succeed.
      try {
        db.prepare(
          `DELETE FROM transcript_chat_idempotency
            WHERE terminal_id = ? AND transcript_event_id = ?`
        ).run(args.terminalSessionId, args.transcriptEventId);
      } catch { /* dedupe rollback best-effort */ }
      return false;
    }

    // Patch the dedupe row with the real message id for forensic links.
    try {
      db.prepare(
        `UPDATE transcript_chat_idempotency
            SET chat_message_id = ?
          WHERE terminal_id = ? AND transcript_event_id = ?`
      ).run(newMessage.id, args.terminalSessionId, args.transcriptEventId);
    } catch { /* id-patch best-effort */ }

    try {
      broadcastToRoom(roomId, { type: 'message_added', message: newMessage });
    } catch { /* broadcast best-effort */ }
    return true;
  } catch {
    // Helper MUST NEVER break transcript ingestion.
    return false;
  }
}

/** Test-only: clear the dedupe table. Tests run against per-worker tmp DBs
 *  so this is safe; never call from production code. */
export function _resetTranscriptToChatFanoutForTests(): void {
  try {
    const db = getIdentityDb();
    db.prepare(`DELETE FROM transcript_chat_idempotency`).run();
  } catch { /* no-op when db unavailable */ }
}
