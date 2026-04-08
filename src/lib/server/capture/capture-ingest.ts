// ANT v3 — Shell hook capture ingest
//
// Polls ~/.local/state/ant/capture/ for .events files written by ant.zsh / ant.bash.
// On each command_end event, inserts a row into command_events.
// Byte offsets are tracked in server_state so restarts pick up where they left off.

import { existsSync, mkdirSync, readdirSync, statSync, openSync, readSync, closeSync } from 'fs';
import { join } from 'path';
import { queries } from '../db.js';
import getDb from '../db.js';

const CAPTURE_DIR = join(process.env.HOME || '/tmp', '.local', 'state', 'ant', 'capture');
const POLL_INTERVAL_MS = 500;

// In-memory offset cache (filename → bytes consumed)
const offsets = new Map<string, number>();

let pollTimer: ReturnType<typeof setInterval> | null = null;
let _insertStmt: any = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function startCaptureIngest(): void {
  // Ensure the capture directory exists — don't crash if it's missing
  try {
    mkdirSync(CAPTURE_DIR, { recursive: true });
  } catch {
    // non-fatal
  }

  console.log(`[capture] Shell hook ingest watching ${CAPTURE_DIR}`);

  // Restore byte offsets from server_state on startup (catch-up after restart)
  loadOffsets();

  // Immediate first scan to catch any events written while server was down
  scanAndIngest();

  // Poll continuously
  pollTimer = setInterval(scanAndIngest, POLL_INTERVAL_MS);
}

export function stopCaptureIngest(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function getInsertStmt(): any {
  if (!_insertStmt) {
    const db = getDb();
    _insertStmt = db.prepare(`
      INSERT INTO command_events
        (session_id, command, cwd, exit_code, started_at, ended_at, duration_ms, output_snippet)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }
  return _insertStmt;
}

function insertCommand(
  sessionId: string,
  command: string,
  cwd: string | null,
  exitCode: number | null,
  startedAt: string,
  endedAt: string,
  durationMs: number | null,
  outputSnippet: string | null = null
): void {
  getInsertStmt().run(sessionId, command, cwd, exitCode, startedAt, endedAt, durationMs, outputSnippet);
}

function loadOffsets(): void {
  try {
    if (!existsSync(CAPTURE_DIR)) return;
    for (const file of readdirSync(CAPTURE_DIR)) {
      if (!file.endsWith('.events')) continue;
      const stored = queries.getServerState(`cursor:${file}`);
      if (stored) {
        offsets.set(file, parseInt(stored, 10) || 0);
      }
    }
  } catch {
    // Non-fatal — start from 0 for each file
  }
}

function saveOffset(filename: string, offset: number): void {
  offsets.set(filename, offset);
  try {
    queries.setState(`cursor:${filename}`, String(offset));
  } catch {
    // Non-fatal
  }
}

function scanAndIngest(): void {
  try {
    if (!existsSync(CAPTURE_DIR)) return;
    for (const file of readdirSync(CAPTURE_DIR)) {
      if (file.endsWith('.events')) {
        ingestEventsFile(file);
      }
    }
  } catch {
    // Non-fatal
  }
}

function ingestEventsFile(filename: string): void {
  const fullPath = join(CAPTURE_DIR, filename);
  if (!existsSync(fullPath)) return;

  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(fullPath);
  } catch {
    return;
  }

  const currentOffset = offsets.get(filename) ?? 0;
  // Detect truncation / log rotation
  const offset = stat.size < currentOffset ? 0 : currentOffset;
  if (stat.size <= offset) return;

  // Read only the new bytes since last poll
  const bytesToRead = stat.size - offset;
  const buffer = Buffer.alloc(bytesToRead);
  let fd: number;
  try {
    fd = openSync(fullPath, 'r');
  } catch {
    return;
  }
  try {
    readSync(fd, buffer, 0, bytesToRead, offset);
  } finally {
    closeSync(fd);
  }

  saveOffset(filename, offset + bytesToRead);

  // Parse NDJSON — correlate command_start/command_end within this chunk
  const lines = buffer.toString('utf-8').split('\n').filter(Boolean);
  const pending = new Map<string, any>();

  for (const line of lines) {
    try {
      processEvent(JSON.parse(line), pending);
    } catch {
      // Skip malformed lines
    }
  }
}

function processEvent(event: any, pending: Map<string, any>): void {
  if (event.event === 'command_start') {
    pending.set(event.command ?? '', event);
    return;
  }

  if (event.event !== 'command_end') return;

  const sessionId: string = event.session ?? '';
  if (!sessionId) return; // hooks fired outside an ANT capture session

  const command: string = event.command ?? '(unknown)';
  const cwd: string | null = event.cwd ?? null;
  const exitCode: number | null = event.exit_code ?? null;
  const durationMs: number | null = event.duration_ms ?? null;
  const endTs: number = event.ts ?? Date.now();

  const startEvent = pending.get(command) ?? null;
  const startedAt: string = startEvent
    ? new Date(startEvent.ts).toISOString()
    : new Date(endTs - (durationMs ?? 0)).toISOString();
  const endedAt: string = new Date(endTs).toISOString();

  // First 500 chars of output_snippet if the event includes it (future extension)
  const outputSnippet: string | null = event.output_snippet
    ? String(event.output_snippet).slice(0, 500)
    : null;

  if (startEvent) pending.delete(command);

  try {
    insertCommand(sessionId, command, cwd, exitCode, startedAt, endedAt, durationMs, outputSnippet);
  } catch {
    // Non-fatal — session may not exist in DB yet (hooks run before session is registered)
  }
}
