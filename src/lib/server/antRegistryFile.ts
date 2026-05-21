import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { getIdentityDb } from './db';

export type AntRegistryProjectionResult = {
  path: string;
  rows: number;
  skipped: boolean;
};

type RegistryRow = {
  session_id: string;
  name: string | null;
  handle: string | null;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  terminal_pid: number | null;
  terminal_updated_at: number | null;
  terminal_source: string | null;
  record_updated_at_ms: number | null;
};

export function antRegistryFilePath(): string {
  const configured = process.env.ANT_REGISTRY_FILE_PATH || process.env.ANT_AGENT_REGISTRY_PATH;
  if (configured && configured.trim().length > 0) return configured.trim();
  return join(homedir(), 'Documents', 'ant-registry.md');
}

export function buildAntRegistryMarkdown(nowMs = Date.now()): string {
  const rows = listRegistryRows();
  const lines = [
    '# ANT Agent Registry',
    '',
    `Updated: ${new Date(nowMs).toISOString()}`,
    `Server: ${process.env.ANT_SERVER_URL || 'http://localhost:6174'}`,
    '',
    '| Handle | Name | Kind | PID | Tmux session | Last seen | Source |',
    '|---|---|---|---:|---|---|---|'
  ];

  for (const row of rows) {
    lines.push(`| ${[
      md(row.handle || handleFromName(row.name || row.session_id)),
      md(row.name || row.session_id),
      md(row.agent_kind || ''),
      row.terminal_pid ? String(row.terminal_pid) : '',
      md(tmuxSession(row.tmux_target_pane)),
      md(lastSeenIso(row)),
      md(row.terminal_source || '')
    ].join(' | ')} |`);
  }

  lines.push('');
  lines.push('<!-- This file is a projected mirror. ANT database state is canonical. -->');
  return lines.join('\n');
}

export function projectAntRegistryFile(options: { force?: boolean } = {}): AntRegistryProjectionResult {
  const path = antRegistryFilePath();
  if (!options.force && process.env.NODE_ENV === 'test' && !process.env.ANT_REGISTRY_FILE_PATH && !process.env.ANT_AGENT_REGISTRY_PATH) {
    return { path, rows: 0, skipped: true };
  }
  const content = buildAntRegistryMarkdown();
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
  const rows = content.split('\n').filter((line) => line.startsWith('| ') && !line.includes('---')).length - 1;
  return { path, rows: Math.max(0, rows), skipped: false };
}

export function projectAntRegistryFileBestEffort(): void {
  try {
    projectAntRegistryFile();
  } catch {
    // Registry projection must never block registration or terminal routing.
  }
}

function listRegistryRows(): RegistryRow[] {
  const db = getIdentityDb();
  const recordRows = db.prepare(`
    SELECT
      tr.session_id,
      tr.name,
      tr.handle,
      tr.agent_kind,
      tr.tmux_target_pane,
      t.pid AS terminal_pid,
      t.updated_at AS terminal_updated_at,
      t.source AS terminal_source,
      tr.updated_at_ms AS record_updated_at_ms
    FROM terminal_records tr
    LEFT JOIN terminals t ON t.id = tr.session_id
  `).all() as RegistryRow[];

  const seen = new Set(recordRows.map((row) => row.session_id));
  // Filter out browser-session rows: those are page-load tracking entries
  // (cookie issuance, identity-gate pidchain stub, etc.), not operator-
  // named terminals. Including them was noise — the Registry should be a
  // human-readable list of REAL agents, not a SQL dump. Per JWPK
  // 2026-05-21 ("ANT Registry.md is filled with a load of noise…").
  const terminalOnlyRows = db.prepare(`
    SELECT
      t.id AS session_id,
      t.name AS name,
      NULL AS handle,
      t.agent_kind AS agent_kind,
      t.tmux_target_pane AS tmux_target_pane,
      t.pid AS terminal_pid,
      t.updated_at AS terminal_updated_at,
      t.source AS terminal_source,
      NULL AS record_updated_at_ms
    FROM terminals t
    WHERE t.source NOT LIKE 'browser-session%'
      AND (t.agent_kind IS NULL OR t.agent_kind != 'browser')
  `).all() as RegistryRow[];

  return [...recordRows, ...terminalOnlyRows.filter((row) => !seen.has(row.session_id))]
    .sort((a, b) => lastSeenMs(b) - lastSeenMs(a));
}

function md(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function handleFromName(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'terminal';
  return `@${slug}`;
}

function tmuxSession(targetPane: string | null): string {
  if (!targetPane) return '';
  const [session] = targetPane.split(':');
  return session || targetPane;
}

function lastSeenMs(row: RegistryRow): number {
  return Math.max(
    row.record_updated_at_ms ?? 0,
    row.terminal_updated_at ? row.terminal_updated_at * 1000 : 0
  );
}

function lastSeenIso(row: RegistryRow): string {
  const ms = lastSeenMs(row);
  return ms > 0 ? new Date(ms).toISOString() : '';
}
