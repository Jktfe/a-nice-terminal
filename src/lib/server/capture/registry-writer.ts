// ANT v3 — Obsidian Registry writer
//
// Maintains <vault>/ANT Registry.md as a live, formatted snapshot of the
// session table. Called from the session create/archive/delete endpoints so
// the file stays current without a polling loop.
//
// Never throws — registry writing is a courtesy, not a critical path.

import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { queries } from '../db.js';
import { obsidianVaultPath } from './obsidian-writer.js';

const REGISTRY_FILENAME = 'ANT Registry.md';
// Set ANT_REGISTRY_SSH_HOST to your tailnet host (e.g. mymac.tailnet.ts.net)
// to render `ssh://...` links in the registry. Empty default = no host link.
const SSH_HOST = process.env.ANT_REGISTRY_SSH_HOST || '';
const COALESCE_MS = 500;

let pendingTimer: ReturnType<typeof setTimeout> | null = null;
let lastWrittenAt = 0;

type SessionRow = {
  id: string;
  name: string;
  type: string;
  ttl: string | null;
  status: string | null;
  archived: number;
  deleted_at: string | null;
  last_activity: string | null;
  updated_at: string | null;
  handle: string | null;
  alias: string | null;
  tmux_id: string | null;
  cli_flag: string | null;
  is_aon: number;
  linked_chat_id: string | null;
  root_dir: string | null;
};

function fmtTime(value: string | null | undefined): string {
  if (!value) return '—';
  // Strings come back as either "YYYY-MM-DD HH:MM:SS" (UTC, SQLite) or ISO.
  const normalised = value.includes('T') ? value : value.replace(' ', 'T') + 'Z';
  const d = new Date(normalised);
  if (Number.isNaN(d.getTime())) return value;
  // Display in Europe/London — closest match without a tz library.
  return d.toISOString().replace('T', ' ').replace(/:\d{2}\.\d{3}Z$/, ' UTC');
}

function safeCell(value: string | null | undefined): string {
  return (value ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').trim() || '—';
}

function ttlBadge(s: SessionRow): string {
  if (s.is_aon || s.ttl === 'forever') return 'AON';
  return s.ttl || '—';
}

function sshCommand(t: SessionRow): string {
  const tmuxTarget = t.tmux_id || t.id;
  const launcher = t.alias || t.handle?.replace(/^@/, '') || '';
  const tail = launcher ? ` ; ${launcher}` : '';
  return `\`ssh ${SSH_HOST} -t tmux attach-session -t ${tmuxTarget}${tail}\``;
}

function lookupNameMap(rows: SessionRow[]): Map<string, SessionRow> {
  const map = new Map<string, SessionRow>();
  for (const row of rows) map.set(row.id, row);
  return map;
}

function renderTerminalsTable(terminals: SessionRow[]): string {
  if (terminals.length === 0) return '_No active terminals._';
  const header = '| Name | Handle | Agent | TTL | Last activity | SSH |\n|---|---|---|---|---|---|';
  const rows = terminals
    .slice()
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map((t) =>
      `| ${safeCell(t.name)} | ${safeCell(t.handle)} | ${safeCell(t.cli_flag)} | ${safeCell(ttlBadge(t))} | ${safeCell(fmtTime(t.last_activity || t.updated_at))} | ${sshCommand(t)} |`,
    );
  return [header, ...rows].join('\n');
}

function renderChatsTable(chats: SessionRow[], idMap: Map<string, SessionRow>, linkedChatIds: Set<string>): string {
  const visible = chats.filter((c) => !linkedChatIds.has(c.id));
  if (visible.length === 0) return '_No standalone chat rooms._';
  const header = '| Name | Handle | Linked terminal | Updated |\n|---|---|---|---|';
  const rows = visible
    .slice()
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map((c) => {
      const linkedTermName = linkedTerminalName(c, idMap);
      return `| ${safeCell(c.name)} | ${safeCell(c.handle)} | ${safeCell(linkedTermName)} | ${safeCell(fmtTime(c.updated_at))} |`;
    });
  return [header, ...rows].join('\n');
}

function linkedTerminalName(chat: SessionRow, idMap: Map<string, SessionRow>): string | null {
  // chats appearing as linked from a terminal: find any terminal whose linked_chat_id matches.
  for (const s of idMap.values()) {
    if (s.type === 'terminal' && s.linked_chat_id === chat.id) return s.name;
  }
  return null;
}

function renderRecoverable(rows: SessionRow[]): string {
  if (rows.length === 0) return '_None._';
  const header = '| Name | Type | Status | Since |\n|---|---|---|---|';
  const lines = rows
    .slice()
    .sort((a, b) => (b.deleted_at || b.updated_at || '').localeCompare(a.deleted_at || a.updated_at || ''))
    .map((r) => {
      const status = r.deleted_at ? 'soft-deleted' : 'archived';
      const since = r.deleted_at || r.updated_at;
      return `| ${safeCell(r.name)} | ${safeCell(r.type)} | ${status} | ${safeCell(fmtTime(since))} |`;
    });
  return [header, ...lines].join('\n');
}

function buildMarkdown(): string {
  const live = (queries.listSessions() as SessionRow[]) ?? [];
  const recoverable = (queries.listRecoverable() as SessionRow[]) ?? [];

  const idMap = lookupNameMap(live);
  const terminals = live.filter((s) => s.type === 'terminal');
  const chats = live.filter((s) => s.type === 'chat');
  const linkedChatIds = new Set(
    terminals.map((t) => t.linked_chat_id).filter((id): id is string => Boolean(id)),
  );

  const generatedAt = new Date().toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
  const counts = `${terminals.length} terminal${terminals.length === 1 ? '' : 's'} · ${chats.length} chat${chats.length === 1 ? '' : 's'} · ${recoverable.length} recoverable`;

  return [
    '---',
    'type: ant-registry',
    `generated_at: ${generatedAt}`,
    `terminals: ${terminals.length}`,
    `chats: ${chats.length}`,
    `recoverable: ${recoverable.length}`,
    '---',
    '',
    '# ANT Registry',
    '',
    `_Auto-generated from \`sessions\` table. Last updated **${generatedAt}**. ${counts}._`,
    '',
    '## Active terminals',
    '',
    renderTerminalsTable(terminals),
    '',
    '## Active chats',
    '',
    renderChatsTable(chats, idMap, linkedChatIds),
    '',
    '## Recoverable (archived or soft-deleted)',
    '',
    renderRecoverable(recoverable),
    '',
    '## Quick links',
    '',
    '- [Plan view](https://localhost:6458/plan)',
    '- [Asks queue](https://localhost:6458/asks)',
    '- [Dashboard](https://localhost:6458/)',
    '',
  ].join('\n');
}

function writeRegistryNow(): void {
  const vault = obsidianVaultPath();
  if (!existsSync(vault)) return;
  try {
    const md = buildMarkdown();
    writeFileSync(join(vault, REGISTRY_FILENAME), md, 'utf8');
    lastWrittenAt = Date.now();
  } catch (e) {
    console.warn('[registry] write failed:', e);
  }
}

// Schedule a debounced write. Multiple rapid lifecycle hooks within
// COALESCE_MS coalesce into a single file rewrite.
export function scheduleRegistryUpdate(): void {
  if (pendingTimer) return;
  const wait = Math.max(0, COALESCE_MS - (Date.now() - lastWrittenAt));
  pendingTimer = setTimeout(() => {
    pendingTimer = null;
    writeRegistryNow();
  }, wait);
}

// Force a synchronous rewrite — used for boot-time initialisation and tests.
export function writeRegistrySync(): void {
  if (pendingTimer) {
    clearTimeout(pendingTimer);
    pendingTimer = null;
  }
  writeRegistryNow();
}
