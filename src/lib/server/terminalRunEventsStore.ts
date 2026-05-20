/**
 * terminalRunEventsStore — append-only "ANT view retained forever" scrollback.
 * Per JWPK terminals-redesign + linkedchat-backend-v3-audit-2026-05-14
 * (LIFT v3 run_events shape into fresh-ANT). T2a smallest-passable slice:
 * just append + listLatest + listSince. Driver-classified events come in
 * follow-up T2b (driver Layer A lift) + T2c (output-classifier Layer B).
 */

import { getIdentityDb } from './db';
import { stripAnsi } from './classifiers/stripAnsi';

export type TerminalRunEventTrust = 'high' | 'medium' | 'raw';

export type TerminalRunEvent = {
  id: number;
  terminal_id: string;
  ts_ms: number;
  source: string;
  trust: TerminalRunEventTrust;
  kind: string;
  text: string;
  payload: string;
  raw_ref: string | null;
  transcript_event_id?: string | null;
};

export type AppendInput = {
  terminalId: string;
  kind: string;
  text?: string;
  source?: string;
  trust?: TerminalRunEventTrust;
  payload?: Record<string, unknown>;
  rawRef?: string | null;
  tsMs?: number;
  // V4-BLOCKER-B: native per-line stable id from the source transcript.
  // When set, INSERT is idempotent via the partial UNIQUE index — re-reads
  // after restart collapse to no-ops. PTY/classifier rows leave this null.
  transcriptEventId?: string | null;
};

export function appendTerminalRunEvent(input: AppendInput): TerminalRunEvent {
  const db = getIdentityDb();
  const tsMs = input.tsMs ?? Date.now();
  const source = input.source ?? 'pty';
  const trust: TerminalRunEventTrust = input.trust ?? 'raw';
  const rawText = input.text ?? '';
  // CLEANUP slice (2026-05-15, V4-BLOCKER-A): the delta-4 diagnostic
  // (removed) proved transcript-tail mappers carry control bytes/ANSI into
  // non-raw rows. Sanitize at the persistence boundary so ANT/Chat views
  // render clean. kind=raw is left untouched — the RAW view feeds an
  // xterm renderer that needs literal escape bytes.
  const text = input.kind === 'raw' ? rawText : stripAnsi(rawText);
  const payload = JSON.stringify(input.payload ?? {});
  const rawRef = input.rawRef ?? null;
  const transcriptEventId = input.transcriptEventId ?? null;
  // V4-BLOCKER-B: when a native transcript id is present, ON CONFLICT DO
  // NOTHING makes restart re-reads idempotent. result.changes === 0 means
  // the row already existed — return the existing row so callers still get
  // a coherent shape.
  // The unique index is PARTIAL (WHERE transcript_event_id IS NOT NULL),
  // so the ON CONFLICT target MUST restate that predicate to bind to it.
  const result = db.prepare(
    `INSERT INTO terminal_run_events (terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref, transcript_event_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (terminal_id, transcript_event_id) WHERE transcript_event_id IS NOT NULL DO NOTHING`
  ).run(input.terminalId, tsMs, source, trust, input.kind, text, payload, rawRef, transcriptEventId);
  if (result.changes === 0 && transcriptEventId) {
    const existing = db.prepare(
      `SELECT id, terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref, transcript_event_id
       FROM terminal_run_events
       WHERE terminal_id = ? AND transcript_event_id = ?`
    ).get(input.terminalId, transcriptEventId) as TerminalRunEvent | undefined;
    if (existing) return existing;
  }
  return {
    id: Number(result.lastInsertRowid),
    terminal_id: input.terminalId, ts_ms: tsMs, source, trust,
    kind: input.kind, text, payload, raw_ref: rawRef,
    transcript_event_id: transcriptEventId
  };
}

function listClause(column: 'kind' | 'source', values: string[] | undefined): { sql: string; args: string[] } {
  if (!values || values.length === 0) return { sql: '', args: [] };
  const placeholders = values.map(() => '?').join(',');
  return { sql: ` AND ${column} IN (${placeholders})`, args: values };
}

// P0 TRANSCRIPT-AUTHORITATIVE-GATE (2026-05-15): when a terminal has ANY
// src='transcript' rows, the CLI's own JSONL transcript is authoritative.
// The regex PTY classifier still emits kind=message/thinking/tool_call
// from TUI chrome into the same feed (the surgical pivot's suppression
// was never wired). Suppress src='pty' NON-raw rows so the ANT view shows
// only the clean transcript stream. src='pty' kind='raw' STAYS — the RAW
// view needs literal passthrough. Terminals with NO transcript rows
// (bare shells, non-transcript CLIs) are unaffected — full feed served.
function terminalHasTranscriptRows(db: ReturnType<typeof getIdentityDb>, terminalId: string): boolean {
  const row = db.prepare(
    `SELECT 1 FROM terminal_run_events
      WHERE terminal_id = ? AND source = 'transcript' AND deleted_at_ms IS NULL
      LIMIT 1`
  ).get(terminalId);
  return row !== undefined;
}

// Suppress pty non-raw rows when transcript is authoritative for this
// terminal. Returns a SQL fragment + (no extra args).
const PTY_NONRAW_SUPPRESSION = ` AND NOT (source = 'pty' AND kind != 'raw')`;

export function listLatestTerminalRunEvents(
  terminalId: string,
  limit = 200,
  kinds?: string[],
  sources?: string[]
): TerminalRunEvent[] {
  const db = getIdentityDb();
  const k = listClause('kind', kinds);
  const s = listClause('source', sources);
  const gate = terminalHasTranscriptRows(db, terminalId) ? PTY_NONRAW_SUPPRESSION : '';
  return (db.prepare(
    `SELECT id, terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref
     FROM terminal_run_events
     WHERE terminal_id = ? AND deleted_at_ms IS NULL${gate}${k.sql}${s.sql}
     ORDER BY ts_ms DESC LIMIT ?`
  ).all(terminalId, ...k.args, ...s.args, limit) as TerminalRunEvent[]).reverse();
}

export function listTerminalRunEventsSince(
  terminalId: string,
  sinceMs: number,
  limit = 500,
  kinds?: string[],
  sources?: string[]
): TerminalRunEvent[] {
  const db = getIdentityDb();
  const k = listClause('kind', kinds);
  const s = listClause('source', sources);
  const gate = terminalHasTranscriptRows(db, terminalId) ? PTY_NONRAW_SUPPRESSION : '';
  return db.prepare(
    `SELECT id, terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref
     FROM terminal_run_events
     WHERE terminal_id = ? AND ts_ms > ? AND deleted_at_ms IS NULL${gate}${k.sql}${s.sql}
     ORDER BY ts_ms ASC LIMIT ?`
  ).all(terminalId, sinceMs, ...k.args, ...s.args, limit) as TerminalRunEvent[];
}

export function searchTerminalRunEvents(
  terminalId: string,
  query: string,
  limit = 100,
  kinds?: string[],
  sources?: string[]
): TerminalRunEvent[] {
  const db = getIdentityDb();
  const k = listClause('kind', kinds);
  const s = listClause('source', sources);
  const gate = terminalHasTranscriptRows(db, terminalId) ? PTY_NONRAW_SUPPRESSION : '';
  const like = '%' + query.replace(/%/g, '%%').replace(/_/g, '\\_') + '%';
  return db.prepare(
    `SELECT id, terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref
     FROM terminal_run_events
     WHERE terminal_id = ? AND text LIKE ? AND deleted_at_ms IS NULL${gate}${k.sql}${s.sql}
     ORDER BY ts_ms DESC LIMIT ?`
  ).all(terminalId, like, ...k.args, ...s.args, limit) as TerminalRunEvent[];
}
