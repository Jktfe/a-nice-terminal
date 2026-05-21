#!/usr/bin/env node
// agent-kind-janitor — one-time drift cleanup for terminals.agent_kind.
// MIGRATES known aliases (e.g. codex → codex_cli), PRESERVES remote/browser
// (server-internal kinds), FLAGS unknown rows + truly-unrecognised values
// (logged to stderr, no mutation). M3.2d Q4 — NOT a CLI verb.
import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

// Pure functions live below so the bun-test harness can import + drive them
// with an in-memory db without invoking main().

export const ALIAS_MAP = { codex: 'codex_cli' };
export const VALID_CLIENT = new Set(['claude_code', 'codex_cli', 'cursor', 'gemini', 'aider', 'generic-shell']);
export const RESERVED = new Set(['remote', 'browser']);
export const SENTINEL = new Set(['unknown']);

export function classifyRow(agentKind) {
  if (agentKind === null || agentKind === undefined) return { action: 'skip', reason: 'null-kind' };
  if (RESERVED.has(agentKind)) return { action: 'preserve', reason: 'server-reserved' };
  if (SENTINEL.has(agentKind)) return { action: 'flag', reason: 'detector-sentinel' };
  if (VALID_CLIENT.has(agentKind)) return { action: 'preserve', reason: 'canonical' };
  if (agentKind in ALIAS_MAP) return { action: 'migrate', reason: 'alias', target: ALIAS_MAP[agentKind] };
  return { action: 'flag', reason: 'unrecognised' };
}

export function runJanitor(db, { apply }) {
  const rows = db.prepare(`SELECT id, agent_kind FROM terminals`).all();
  const stats = { migrated: 0, flagged: 0, preserved: 0, skipped: 0 };
  const flags = [];
  const migrate = db.prepare(`UPDATE terminals SET agent_kind = ?, updated_at = ? WHERE id = ?`);
  const nowSec = Math.floor(Date.now() / 1000);
  for (const row of rows) {
    const verdict = classifyRow(row.agent_kind);
    if (verdict.action === 'migrate') {
      if (apply) migrate.run(verdict.target, nowSec, row.id);
      stats.migrated += 1;
    } else if (verdict.action === 'flag') {
      flags.push({ id: row.id, agent_kind: row.agent_kind, reason: verdict.reason });
      stats.flagged += 1;
    } else if (verdict.action === 'preserve') stats.preserved += 1;
    else stats.skipped += 1;
  }
  return { stats, flags };
}

function defaultDbPath() {
  const env = process.env.ANT_FRESH_DB_PATH;
  if (env && env.length > 0) return env;
  return join(process.env.HOME ?? '', '.ant', 'fresh-ant.db');
}

function main(argv) {
  const apply = argv.includes('--apply');
  const dryRun = argv.includes('--dry-run') || !apply;
  const path = defaultDbPath();
  if (path !== ':memory:' && !existsSync(path)) {
    process.stderr.write(`db not found: ${path}\n`);
    process.exit(1);
  }
  const db = new Database(path, { readonly: dryRun });
  try {
    const { stats, flags } = runJanitor(db, { apply: !dryRun });
    if (flags.length > 0) {
      process.stderr.write(`flagged ${flags.length} rows for operator review:\n`);
      for (const f of flags) process.stderr.write(`  ${f.id}\tagent_kind=${f.agent_kind}\treason=${f.reason}\n`);
    }
    const mode = dryRun ? '[dry-run]' : '[apply]';
    process.stdout.write(`${mode} migrated=${stats.migrated} flagged=${stats.flagged} preserved=${stats.preserved} skipped=${stats.skipped}\n`);
  } finally { db.close(); }
}

const isEntry = typeof process !== 'undefined' && process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (isEntry) main(process.argv.slice(2));
