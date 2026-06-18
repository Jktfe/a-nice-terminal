/**
 * terminalRunEventsStore — append-only "ANT view retained forever" scrollback.
 * Per JWPK terminals-redesign + linkedchat-backend-v3-audit-2026-05-14
 * (LIFT v3 run_events shape into fresh-ANT). T2a smallest-passable slice:
 * just append + listLatest + listSince. Driver-classified events come in
 * follow-up T2b (driver Layer A lift) + T2c (output-classifier Layer B).
 */

import { getIdentityDb } from './db';
import { getTelemetryDb, telemetrySidecarEnabled } from './telemetryDb';
import { stripAnsi } from './classifiers/stripAnsi';

// Telemetry-sidecar handle selection (audit finding A). When the sidecar is
// on, the firehose lives in the telemetry DB; writes go there. Reads union the
// telemetry DB (new rows) with the identity DB (old rows not yet backfilled) —
// the backfill copies-then-deletes per batch, so every row is in exactly one
// file and the union never double-counts. After the source drains, the
// identity-DB branch returns nothing (empty table) and is removed in Phase 3.
type RunEventDb = ReturnType<typeof getIdentityDb>;
function runEventWriteDb(): RunEventDb {
  return telemetrySidecarEnabled() ? getTelemetryDb() : getIdentityDb();
}
function runEventReadDbs(): RunEventDb[] {
  return telemetrySidecarEnabled() ? [getTelemetryDb(), getIdentityDb()] : [getIdentityDb()];
}

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
  const db = runEventWriteDb();
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
function terminalHasTranscriptRows(terminalId: string): boolean {
  // A terminal's transcript rows can be in either DB during the backfill
  // window, so the authoritative-transcript gate checks across both.
  return runEventReadDbs().some(
    (db) =>
      db
        .prepare(
          `SELECT 1 FROM terminal_run_events
            WHERE terminal_id = ? AND source = 'transcript' AND deleted_at_ms IS NULL
            LIMIT 1`
        )
        .get(terminalId) !== undefined
  );
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
  const k = listClause('kind', kinds);
  const s = listClause('source', sources);
  const gate = terminalHasTranscriptRows(terminalId) ? PTY_NONRAW_SUPPRESSION : '';
  const sql = `SELECT id, terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref
     FROM terminal_run_events
     WHERE terminal_id = ? AND deleted_at_ms IS NULL${gate}${k.sql}${s.sql}
     ORDER BY ts_ms DESC LIMIT ?`;
  const rows = runEventReadDbs().flatMap(
    (db) => db.prepare(sql).all(terminalId, ...k.args, ...s.args, limit) as TerminalRunEvent[]
  );
  // Merge newest-first across DBs, cap to limit, then ascending for the caller.
  return rows.sort((a, b) => b.ts_ms - a.ts_ms).slice(0, limit).reverse();
}

export function listTerminalRunEventsSince(
  terminalId: string,
  sinceMs: number,
  limit = 500,
  kinds?: string[],
  sources?: string[]
): TerminalRunEvent[] {
  const k = listClause('kind', kinds);
  const s = listClause('source', sources);
  const gate = terminalHasTranscriptRows(terminalId) ? PTY_NONRAW_SUPPRESSION : '';
  const sql = `SELECT id, terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref
     FROM terminal_run_events
     WHERE terminal_id = ? AND ts_ms > ? AND deleted_at_ms IS NULL${gate}${k.sql}${s.sql}
     ORDER BY ts_ms ASC LIMIT ?`;
  const rows = runEventReadDbs().flatMap(
    (db) => db.prepare(sql).all(terminalId, sinceMs, ...k.args, ...s.args, limit) as TerminalRunEvent[]
  );
  return rows.sort((a, b) => a.ts_ms - b.ts_ms).slice(0, limit);
}

export function searchTerminalRunEvents(
  terminalId: string,
  query: string,
  limit = 100,
  kinds?: string[],
  sources?: string[]
): TerminalRunEvent[] {
  const k = listClause('kind', kinds);
  const s = listClause('source', sources);
  const gate = terminalHasTranscriptRows(terminalId) ? PTY_NONRAW_SUPPRESSION : '';
  const like = '%' + query.replace(/%/g, '%%').replace(/_/g, '\\_') + '%';
  const sql = `SELECT id, terminal_id, ts_ms, source, trust, kind, text, payload, raw_ref
     FROM terminal_run_events
     WHERE terminal_id = ? AND text LIKE ? AND deleted_at_ms IS NULL${gate}${k.sql}${s.sql}
     ORDER BY ts_ms DESC LIMIT ?`;
  const rows = runEventReadDbs().flatMap(
    (db) => db.prepare(sql).all(terminalId, like, ...k.args, ...s.args, limit) as TerminalRunEvent[]
  );
  return rows.sort((a, b) => b.ts_ms - a.ts_ms).slice(0, limit);
}

/**
 * Soft-delete every run-event for a terminal (sets deleted_at_ms). The rows
 * STAY in the DB — recoverable, respecting the firehose-asset "mine before
 * prune" rule — but are hidden from every reader. Returns the count hidden.
 * Spans both read DBs (telemetry sidecar + identity). Used by archived-terminal
 * delete (after the optional mine/archive step).
 */
export function softDeleteTerminalRunEvents(terminalId: string, nowMs = Date.now()): number {
  let hidden = 0;
  for (const db of runEventReadDbs()) {
    const res = db
      .prepare(`UPDATE terminal_run_events SET deleted_at_ms = ? WHERE terminal_id = ? AND deleted_at_ms IS NULL`)
      .run(nowMs, terminalId);
    hidden += res.changes as number;
  }
  return hidden;
}

/** Read ALL of a terminal's (non-deleted) run-events, oldest-first — for the
 * mine/archive export before a destructive delete. */
export function readAllTerminalRunEventsForArchive(terminalId: string): TerminalRunEvent[] {
  const rows = runEventReadDbs().flatMap(
    (db) =>
      db
        .prepare(`SELECT * FROM terminal_run_events WHERE terminal_id = ? AND deleted_at_ms IS NULL`)
        .all(terminalId) as TerminalRunEvent[]
  );
  return rows.sort((a, b) => a.ts_ms - b.ts_ms);
}
