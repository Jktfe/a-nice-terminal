/**
 * archivedTerminalMineStore — export a retained terminal run-event stream
 * before an archived terminal is removed from the visible archive list.
 *
 * This is intentionally not an LLM lesson extractor. It creates a concrete,
 * capped markdown archive of the retained ANT output and reports the exact
 * event/byte/truncation facts back to the caller. The firehose rows themselves
 * stay in SQLite; the archive file is the "mine first" artifact.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb } from './db';
import { getTelemetryDb, telemetrySidecarEnabled } from './telemetryDb';

type RunEventDb = ReturnType<typeof getIdentityDb>;

export type ArchivedTerminalMineResult = {
  archivePath: string;
  eventCount: number;
  bytesWritten: number;
  truncated: boolean;
};

type RunEventRow = {
  ts_ms: number;
  source: string;
  trust: string;
  kind: string;
  text: string | null;
};

const DEFAULT_MAX_BYTES = 250_000;

function archiveRoot(): string {
  return process.env.ANT_TERMINAL_ARCHIVE_DIR?.trim()
    || join(homedir(), '.ant', 'terminal-archives', 'mined');
}

function safeFileSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'terminal';
}

function readDbs(): RunEventDb[] {
  return telemetrySidecarEnabled() ? [getTelemetryDb(), getIdentityDb()] : [getIdentityDb()];
}

function rowsForTerminal(db: RunEventDb, terminalId: string, maxRows: number): RunEventRow[] {
  return db.prepare(
    `SELECT ts_ms, source, trust, kind, text
       FROM terminal_run_events
      WHERE terminal_id = ?
        AND deleted_at_ms IS NULL
      ORDER BY ts_ms ASC
      LIMIT ?`
  ).all(terminalId, maxRows) as RunEventRow[];
}

function lineFor(row: RunEventRow): string {
  const at = new Date(row.ts_ms).toISOString();
  const text = (row.text ?? '').replace(/\r/g, '');
  return `[${at}] [${row.source}/${row.trust}/${row.kind}] ${text}`.trimEnd();
}

export function mineArchivedTerminalRunEvents(input: {
  terminalId: string;
  displayName: string;
  nowMs?: number;
  maxBytes?: number;
}): ArchivedTerminalMineResult {
  const nowMs = input.nowMs ?? Date.now();
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  const root = archiveRoot();
  mkdirSync(root, { recursive: true });

  const base = `${safeFileSlug(input.displayName)}-${safeFileSlug(input.terminalId)}-${new Date(nowMs).toISOString().replace(/[:.]/g, '-')}.md`;
  const archivePath = join(root, base);
  if (existsSync(archivePath)) {
    throw new Error(`archive file already exists: ${archivePath}`);
  }

  const rows = readDbs()
    .flatMap((db) => rowsForTerminal(db, input.terminalId, maxBytes))
    .sort((a, b) => a.ts_ms - b.ts_ms);

  const header = [
    '---',
    `source: archived-terminal`,
    `terminal_id: ${input.terminalId}`,
    `display_name: ${input.displayName.replace(/\s+/g, ' ').trim()}`,
    `mined_at: ${new Date(nowMs).toISOString()}`,
    `event_count: ${rows.length}`,
    '---',
    '',
    `# Archived terminal: ${input.displayName}`,
    ''
  ].join('\n');

  let body = header;
  let truncated = false;
  for (const row of rows) {
    const next = `${body}${lineFor(row)}\n`;
    if (Buffer.byteLength(next, 'utf8') > maxBytes) {
      truncated = true;
      break;
    }
    body = next;
  }
  if (truncated) body += '\n[archive truncated: byte cap reached]\n';

  writeFileSync(archivePath, body, 'utf8');
  return {
    archivePath,
    eventCount: rows.length,
    bytesWritten: Buffer.byteLength(body, 'utf8'),
    truncated
  };
}
