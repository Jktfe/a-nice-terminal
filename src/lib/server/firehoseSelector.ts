/**
 * firehoseSelector — the high-signal SELECTOR for the firehose MINING PASS
 * (2026-06-10). See docs/superpowers/specs/2026-06-10-firehose-mining-design.md.
 *
 * Pure SQL over the telemetry sidecar DB (no LLM). It lists session windows
 * (sessionReconstruct.listSessionWindows), EXCLUDES already-mined windows
 * (firehoseMiningState.isSessionMined), then flags each remaining window on
 * ANY of:
 *   - errors:  a classified (kind != 'raw') row whose `text` matches the tuned
 *              error pattern set (error|exception|failed|traceback|fatal|panic),
 *              case-insensitive.
 *   - commits: a row whose `text` looks like a git commit / git merge / a
 *              plan-or-milestone update, OR a cli_hook Bash tool-call running
 *              one of those commands.
 *   - long:    eventCount >= minEvents (default 150) OR span >= minSpanMs
 *              (default 20 min).
 *
 * Returns only windows with >=1 signal, each carrying its qualifying signals
 * (for the dry-run report + provenance). Tunable thresholds via opts (the
 * skill wires these from ANT_MINE_* env). Pure read — never writes the firehose.
 */

import { getTelemetryDb } from './telemetryDb';
import { listSessionWindows, type SessionWindow } from './sessionReconstruct';
import { isSessionMined } from './firehoseMiningState';

type TelemetryDb = ReturnType<typeof getTelemetryDb>;

const DEFAULT_MIN_EVENTS = 150;
const DEFAULT_MIN_SPAN_MS = 20 * 60 * 1000; // 20 minutes

/** Classified-row text patterns that flag an errors/failure signal. */
const ERROR_PATTERN = /error|exception|failed|traceback|fatal|panic/i;

/** Text patterns that flag a commit/decision signal (commands or hook cmds). */
const COMMIT_PATTERN = /git\s+commit|git\s+merge|plan\s+update|milestone\s+update/i;

export type SignalKind = 'errors' | 'commits' | 'long';

export type Candidate = {
  window: SessionWindow;
  signals: SignalKind[];
};

type ClassifiedTextRow = { text: string | null };
type HookRow = { tool_name: string | null; payload: string | null };

/**
 * True if any classified (kind != 'raw') row in the window's time range has
 * text matching ERROR_PATTERN. Raw-byte rows are excluded so terminal noise
 * containing "error" can't false-flag a session.
 */
function hasErrorSignal(db: TelemetryDb, window: SessionWindow): boolean {
  // STREAM + early-exit: a busy terminal's window can hold millions of
  // classified rows, so .all() OOMs the heap. iterate() returns one row at a
  // time and the for-of closes the cursor on break. (cleanANT 2026-06-15.)
  const iter = db
    .prepare(
      `SELECT text
         FROM terminal_run_events
        WHERE terminal_id = ?
          AND ts_ms >= ?
          AND ts_ms <= ?
          AND deleted_at_ms IS NULL
          AND kind != 'raw'`
    )
    .iterate(window.terminalId, window.windowStartMs, window.windowEndMs) as IterableIterator<ClassifiedTextRow>;
  for (const r of iter) {
    if (typeof r.text === 'string' && ERROR_PATTERN.test(r.text)) return true;
  }
  return false;
}

/**
 * True if the window has a commit/decision signal: a classified row whose text
 * matches COMMIT_PATTERN, OR a cli_hook Bash tool-call whose command matches it.
 */
function hasCommitSignal(db: TelemetryDb, window: SessionWindow): boolean {
  // STREAM + early-exit (see hasErrorSignal): never materialise a huge window.
  const runIter = db
    .prepare(
      `SELECT text
         FROM terminal_run_events
        WHERE terminal_id = ?
          AND ts_ms >= ?
          AND ts_ms <= ?
          AND deleted_at_ms IS NULL
          AND kind != 'raw'`
    )
    .iterate(window.terminalId, window.windowStartMs, window.windowEndMs) as IterableIterator<ClassifiedTextRow>;
  for (const r of runIter) {
    if (typeof r.text === 'string' && COMMIT_PATTERN.test(r.text)) return true;
  }

  // cli_hook_events are not terminal-scoped (session-keyed), so interleave by
  // time the same way reconstruction does: any hook in the window's range.
  const hookIter = db
    .prepare(
      `SELECT tool_name, payload
         FROM cli_hook_events
        WHERE received_at_ms >= ?
          AND received_at_ms <= ?`
    )
    .iterate(window.windowStartMs, window.windowEndMs) as IterableIterator<HookRow>;
  for (const hook of hookIter) {
    if (hook.tool_name !== 'Bash') continue;
    const command = extractHookCommand(hook.payload);
    if (command && COMMIT_PATTERN.test(command)) return true;
  }
  return false;
}

/** Extract the Bash command string from a cli_hook payload, if present. */
function extractHookCommand(payload: string | null): string | undefined {
  if (!payload) return undefined;
  try {
    const parsed = JSON.parse(payload) as { tool_input?: { command?: unknown } };
    if (parsed?.tool_input && typeof parsed.tool_input.command === 'string') {
      return parsed.tool_input.command;
    }
  } catch {
    /* malformed payload — no command */
  }
  return undefined;
}

/** True if the window is long/sustained by event count OR time span. */
function hasLongSignal(window: SessionWindow, minEvents: number, minSpanMs: number): boolean {
  const span = window.windowEndMs - window.windowStartMs;
  return window.eventCount >= minEvents || span >= minSpanMs;
}

/**
 * List candidate sessions: every NOT-already-mined window that fires at least
 * one signal, each annotated with its qualifying signals. Pure read.
 */
export function selectHighSignalSessions(opts?: {
  minEvents?: number;
  minSpanMs?: number;
  gapMs?: number;
}): Candidate[] {
  const minEvents = opts?.minEvents ?? DEFAULT_MIN_EVENTS;
  const minSpanMs = opts?.minSpanMs ?? DEFAULT_MIN_SPAN_MS;
  const db: TelemetryDb = getTelemetryDb();

  const windows = listSessionWindows({ gapMs: opts?.gapMs });
  const candidates: Candidate[] = [];

  for (const window of windows) {
    if (
      isSessionMined({
        terminalId: window.terminalId,
        windowStartMs: window.windowStartMs,
        windowEndMs: window.windowEndMs
      })
    ) {
      continue;
    }

    const signals: SignalKind[] = [];
    if (hasErrorSignal(db, window)) signals.push('errors');
    if (hasCommitSignal(db, window)) signals.push('commits');
    if (hasLongSignal(window, minEvents, minSpanMs)) signals.push('long');

    if (signals.length > 0) {
      candidates.push({ window, signals });
    }
  }

  return candidates;
}
