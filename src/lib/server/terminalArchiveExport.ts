/**
 * terminalArchiveExport — "mine" half of archived-terminal delete.
 *
 * Before a destructive delete, "Mine & delete" exports the terminal's retained
 * run-events to a durable JSON archive file so the ANT archive value is stored
 * (mineable later) rather than discarded. The endpoint then soft-deletes the
 * hot rows. Returns where it landed + how many events, so antOS can show a
 * truthful confirmation ("archived N events to <path>"), not just "deleted".
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readAllTerminalRunEventsForArchive } from './terminalRunEventsStore';

export type ArchiveResult = { archivedTo: string; eventsArchived: number };

export function defaultTerminalArchiveDir(): string {
  return process.env.ANT_TERMINAL_ARCHIVE_DIR ?? join(homedir(), '.ant', 'terminal-archives');
}

/**
 * Export a terminal's retained run-events to a durable JSON file. Throws on I/O
 * failure so the caller can abort the delete (never delete unmined data on a
 * "mine & delete" when the mine step failed).
 */
export function archiveTerminalRunEvents(
  terminalId: string,
  opts?: { dir?: string; nowMs?: number }
): ArchiveResult {
  const dir = opts?.dir ?? defaultTerminalArchiveDir();
  const nowMs = opts?.nowMs ?? Date.now();
  mkdirSync(dir, { recursive: true });
  const events = readAllTerminalRunEventsForArchive(terminalId);
  const archivedTo = join(dir, `${terminalId}-${nowMs}.json`);
  writeFileSync(
    archivedTo,
    JSON.stringify({ terminalId, archivedAtMs: nowMs, eventCount: events.length, events }, null, 2)
  );
  return { archivedTo, eventsArchived: events.length };
}
