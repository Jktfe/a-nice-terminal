/**
 * sessionReconstruct — windowing + transcript building for the firehose
 * MINING PASS (2026-06-10). See docs/superpowers/specs/2026-06-10-firehose-mining-design.md.
 *
 * A "session" = a terminal's contiguous activity in terminal_run_events, split
 * on an idle gap > gapMs (default 30 min). The mined unit is
 * (terminal_id, window_start_ms, window_end_ms) — "one agent, one stretch of
 * work."
 *
 * reconstructSession pulls a window's terminal_run_events ordered by ts_ms,
 * keeps the CLASSIFIED rows (kind != 'raw') and drops raw-byte noise, prefixes
 * each line with a short kind tag, and interleaves structured cli_hook_events
 * (by received_at_ms in the window's time range) into one readable transcript
 * string. Total bytes are capped (default 200_000) so a pathological session
 * can't blow the extraction context. Pure reads — never writes the firehose.
 */

import { getTelemetryDb } from './telemetryDb';

type TelemetryDb = ReturnType<typeof getTelemetryDb>;

const DEFAULT_GAP_MS = 30 * 60 * 1000; // 30 minutes
const DEFAULT_MAX_BYTES = 200_000;
const TRUNCATION_MARKER = '\n… [transcript truncated: maxBytes cap reached] …';

export type SessionWindow = {
  terminalId: string;
  windowStartMs: number;
  windowEndMs: number;
  eventCount: number;
};

export type ReconstructedSession = {
  window: SessionWindow;
  transcript: string;
  bytes: number;
};

type RunEventRow = {
  terminal_id: string;
  ts_ms: number;
  kind: string;
  text: string | null;
};

type HookEventRow = {
  received_at_ms: number;
  hook_event_name: string;
  tool_name: string | null;
  cwd: string | null;
  payload: string | null;
};

/**
 * Group terminal_run_events by terminal_id (ordered by ts_ms), splitting into
 * windows whenever the idle gap between consecutive events exceeds gapMs.
 * Returns one window per contiguous activity stretch, each with its event
 * count + time bounds. Windows are ordered by (terminalId, windowStartMs).
 */
export function listSessionWindows(opts?: { gapMs?: number }): SessionWindow[] {
  const gapMs = opts?.gapMs ?? DEFAULT_GAP_MS;
  const db: TelemetryDb = getTelemetryDb();

  const rows = db
    .prepare(
      `SELECT terminal_id, ts_ms
         FROM terminal_run_events
        WHERE deleted_at_ms IS NULL
        ORDER BY terminal_id ASC, ts_ms ASC`
    )
    .all() as Array<{ terminal_id: string; ts_ms: number }>;

  const windows: SessionWindow[] = [];
  let current: SessionWindow | null = null;
  let prevTerminal: string | null = null;
  let prevTs = 0;

  for (const row of rows) {
    const sameTerminal = row.terminal_id === prevTerminal;
    const withinGap = sameTerminal && row.ts_ms - prevTs <= gapMs;

    if (current && withinGap) {
      current.windowEndMs = row.ts_ms;
      current.eventCount += 1;
    } else {
      current = {
        terminalId: row.terminal_id,
        windowStartMs: row.ts_ms,
        windowEndMs: row.ts_ms,
        eventCount: 1
      };
      windows.push(current);
    }
    prevTerminal = row.terminal_id;
    prevTs = row.ts_ms;
  }

  return windows;
}

/** Short kind tag prefix for a transcript line, e.g. [message], [tool_call]. */
function kindTag(kind: string): string {
  return `[${kind}]`;
}

/** Render a single hook event into a transcript line. */
function renderHookLine(hook: HookEventRow): string {
  const parts: string[] = [`[hook] ${hook.hook_event_name}`];
  if (hook.tool_name) parts.push(`tool=${hook.tool_name}`);
  if (hook.cwd) parts.push(`cwd=${hook.cwd}`);
  let command: string | undefined;
  if (hook.payload) {
    try {
      const parsed = JSON.parse(hook.payload) as { tool_input?: { command?: unknown } };
      if (parsed?.tool_input && typeof parsed.tool_input.command === 'string') {
        command = parsed.tool_input.command;
      }
    } catch {
      /* malformed payload — skip the command detail */
    }
  }
  if (command) parts.push(`cmd=${command}`);
  return parts.join(' ');
}

/**
 * Reconstruct a single session window into an ordered, human-readable
 * transcript. Drops kind='raw' rows, prefixes each kept row with its kind tag,
 * interleaves cli_hook_events whose received_at_ms falls in the window range,
 * and caps total bytes (truncating with a marker). Pure read — no writes.
 */
export function reconstructSession(
  window: SessionWindow,
  opts?: { maxBytes?: number }
): ReconstructedSession {
  const maxBytes = opts?.maxBytes ?? DEFAULT_MAX_BYTES;
  const db: TelemetryDb = getTelemetryDb();

  const runRows = db
    .prepare(
      `SELECT terminal_id, ts_ms, kind, text
         FROM terminal_run_events
        WHERE terminal_id = ?
          AND ts_ms >= ?
          AND ts_ms <= ?
          AND deleted_at_ms IS NULL
          AND kind != 'raw'
        ORDER BY ts_ms ASC`
    )
    .all(window.terminalId, window.windowStartMs, window.windowEndMs) as RunEventRow[];

  const hookRows = db
    .prepare(
      `SELECT received_at_ms, hook_event_name, tool_name, cwd, payload
         FROM cli_hook_events
        WHERE received_at_ms >= ?
          AND received_at_ms <= ?
        ORDER BY received_at_ms ASC`
    )
    .all(window.windowStartMs, window.windowEndMs) as HookEventRow[];

  // Merge run-event lines and hook lines into one timeline ordered by time.
  // run events sort key = ts_ms; hook events sort key = received_at_ms.
  type TimedLine = { ts: number; isHook: boolean; line: string };
  const timeline: TimedLine[] = [];

  for (const r of runRows) {
    timeline.push({
      ts: r.ts_ms,
      isHook: false,
      line: `${kindTag(r.kind)} ${r.text ?? ''}`.trimEnd()
    });
  }
  for (const h of hookRows) {
    timeline.push({ ts: h.received_at_ms, isHook: true, line: renderHookLine(h) });
  }

  // Stable sort by time; run events before hook events at the same timestamp
  // keeps "the row, then the hook it triggered" reading order deterministic.
  timeline.sort((a, b) => a.ts - b.ts || Number(a.isHook) - Number(b.isHook));

  let transcript = '';
  let truncated = false;
  const markerBytes = Buffer.byteLength(TRUNCATION_MARKER, 'utf8');

  for (const entry of timeline) {
    const candidate = transcript.length === 0 ? entry.line : `${transcript}\n${entry.line}`;
    const candidateBytes = Buffer.byteLength(candidate, 'utf8');
    // Reserve room for the truncation marker so the final string still fits.
    if (candidateBytes + markerBytes > maxBytes) {
      truncated = true;
      break;
    }
    transcript = candidate;
  }

  if (truncated) {
    transcript = `${transcript}${TRUNCATION_MARKER}`;
  }

  return {
    window,
    transcript,
    bytes: Buffer.byteLength(transcript, 'utf8')
  };
}
