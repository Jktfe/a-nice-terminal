/**
 * cliHookEventsStore — persistence for structured agent-lifecycle events
 * received from CLI hooks (Claude Code today; codex/pi/gemini later).
 *
 * CLI-HOOK-BRIDGE Phase 1A (2026-05-15, JWPK):
 * The receiver-side foundation. Per the per-cli-capability audit (same
 * date), each CLI exposes a different observability surface:
 *   - Claude Code: shell-command hooks (this store's primary input)
 *   - Codex:       JSON-RPC app-server (future phase will pipe into here)
 *   - Pi:          --mode rpc (future phase will pipe into here)
 *   - Gemini:      hooks + OTel (future phase will pipe into here)
 * source_cli partitions rows by origin so a single table covers all four.
 *
 * Promoted-column rationale (see db.ts schema): session_id, hook_event_
 * name, received_at_ms, tool_name are the columns we query for ANT-side
 * UI (per-session activity badge, latest tool-call timeline). transcript_
 * path, cwd, permission_mode, effort_level are present on every Claude
 * hook payload and useful for filtering. Everything else lives in the
 * `payload` JSON blob — the escape hatch for per-event-type fields we
 * don't promote.
 */

import { getIdentityDb } from './db';
import { getTelemetryDb, telemetrySidecarEnabled } from './telemetryDb';

// Telemetry-sidecar handle selection (audit finding A) — same model as
// terminalRunEventsStore: writes go to the telemetry DB when the sidecar is
// on; reads union telemetry (new) + identity (old, not yet backfilled).
type HookDb = ReturnType<typeof getIdentityDb>;
function hookWriteDb(): HookDb {
  return telemetrySidecarEnabled() ? getTelemetryDb() : getIdentityDb();
}
function hookReadDbs(): HookDb[] {
  return telemetrySidecarEnabled() ? [getTelemetryDb(), getIdentityDb()] : [getIdentityDb()];
}
const HOOK_COLS = `id, source_cli, session_id, hook_event_name, received_at_ms,
        transcript_path, cwd, permission_mode, effort_level,
        tool_name, tool_use_id, payload`;
function mergeRecentHookRows(rows: CliHookEventRow[], limit: number): CliHookEventRow[] {
  return rows
    .sort((a, b) => b.received_at_ms - a.received_at_ms || b.id - a.id)
    .slice(0, limit);
}

export type CliHookEventInsert = {
  sourceCli?: string;            // defaults to 'claude-code' if omitted
  sessionId: string;
  hookEventName: string;
  receivedAtMs?: number;          // defaults to Date.now() if omitted
  transcriptPath?: string | null;
  cwd?: string | null;
  permissionMode?: string | null;
  effortLevel?: string | null;
  toolName?: string | null;
  toolUseId?: string | null;
  payload: Record<string, unknown>;
};

export type CliHookEventRow = {
  id: number;
  source_cli: string;
  session_id: string;
  hook_event_name: string;
  received_at_ms: number;
  transcript_path: string | null;
  cwd: string | null;
  permission_mode: string | null;
  effort_level: string | null;
  tool_name: string | null;
  tool_use_id: string | null;
  payload: string;
};

const DEFAULT_SOURCE_CLI = 'claude-code';

export function insertCliHookEvent(input: CliHookEventInsert): CliHookEventRow {
  if (input.sessionId.trim().length === 0) {
    throw new Error('sessionId cannot be blank.');
  }
  if (input.hookEventName.trim().length === 0) {
    throw new Error('hookEventName cannot be blank.');
  }

  const db = hookWriteDb();
  const receivedAtMs = input.receivedAtMs ?? Date.now();
  const sourceCli = input.sourceCli && input.sourceCli.trim().length > 0
    ? input.sourceCli.trim()
    : DEFAULT_SOURCE_CLI;
  const payloadJson = JSON.stringify(input.payload ?? {});

  const result = db.prepare(
    `INSERT INTO cli_hook_events
       (source_cli, session_id, hook_event_name, received_at_ms,
        transcript_path, cwd, permission_mode, effort_level,
        tool_name, tool_use_id, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    sourceCli,
    input.sessionId,
    input.hookEventName,
    receivedAtMs,
    input.transcriptPath ?? null,
    input.cwd ?? null,
    input.permissionMode ?? null,
    input.effortLevel ?? null,
    input.toolName ?? null,
    input.toolUseId ?? null,
    payloadJson
  );

  const id = Number(result.lastInsertRowid);
  return {
    id,
    source_cli: sourceCli,
    session_id: input.sessionId,
    hook_event_name: input.hookEventName,
    received_at_ms: receivedAtMs,
    transcript_path: input.transcriptPath ?? null,
    cwd: input.cwd ?? null,
    permission_mode: input.permissionMode ?? null,
    effort_level: input.effortLevel ?? null,
    tool_name: input.toolName ?? null,
    tool_use_id: input.toolUseId ?? null,
    payload: payloadJson
  };
}

export function listCliHookEventsForSession(
  sessionId: string,
  options?: { limit?: number }
): CliHookEventRow[] {
  const limit = options?.limit ?? 100;
  const sql = `SELECT ${HOOK_COLS}
         FROM cli_hook_events
        WHERE session_id = ?
        ORDER BY received_at_ms DESC, id DESC
        LIMIT ?`;
  const rows = hookReadDbs().flatMap(
    (db) => db.prepare(sql).all(sessionId, limit) as CliHookEventRow[]
  );
  return mergeRecentHookRows(rows, limit);
}

export function getLatestCliHookEventForSession(
  sessionId: string
): CliHookEventRow | undefined {
  return listCliHookEventsForSession(sessionId, { limit: 1 })[0];
}

export function listRecentCliHookEvents(options?: {
  limit?: number;
  sourceCli?: string;
}): CliHookEventRow[] {
  const limit = options?.limit ?? 100;
  const sql = options?.sourceCli
    ? `SELECT ${HOOK_COLS} FROM cli_hook_events WHERE source_cli = ?
        ORDER BY received_at_ms DESC, id DESC LIMIT ?`
    : `SELECT ${HOOK_COLS} FROM cli_hook_events
        ORDER BY received_at_ms DESC, id DESC LIMIT ?`;
  const args = options?.sourceCli ? [options.sourceCli, limit] : [limit];
  const rows = hookReadDbs().flatMap(
    (db) => db.prepare(sql).all(...args) as CliHookEventRow[]
  );
  return mergeRecentHookRows(rows, limit);
}

export function resetCliHookEventsStoreForTests(): void {
  // Clear both DBs — a test may have written to the telemetry sidecar.
  for (const db of new Set<HookDb>([getIdentityDb(), getTelemetryDb()])) {
    try { db.prepare('DELETE FROM cli_hook_events').run(); } catch { /* table may not exist */ }
  }
}
