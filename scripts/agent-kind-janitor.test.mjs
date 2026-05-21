import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import {
  classifyRow,
  runJanitor,
  ALIAS_MAP,
  VALID_CLIENT,
  RESERVED,
  SENTINEL
} from './agent-kind-janitor.mjs';

describe('classifyRow', () => {
  it('skips null/undefined', () => {
    expect(classifyRow(null)).toEqual({ action: 'skip', reason: 'null-kind' });
    expect(classifyRow(undefined)).toEqual({ action: 'skip', reason: 'null-kind' });
  });

  it('preserves reserved kinds', () => {
    for (const kind of RESERVED) {
      expect(classifyRow(kind)).toEqual({ action: 'preserve', reason: 'server-reserved' });
    }
  });

  it('flags sentinel kinds', () => {
    for (const kind of SENTINEL) {
      expect(classifyRow(kind)).toEqual({ action: 'flag', reason: 'detector-sentinel' });
    }
  });

  it('preserves canonical client kinds', () => {
    for (const kind of VALID_CLIENT) {
      expect(classifyRow(kind)).toEqual({ action: 'preserve', reason: 'canonical' });
    }
  });

  it('migrates aliased kinds', () => {
    for (const [from, to] of Object.entries(ALIAS_MAP)) {
      expect(classifyRow(from)).toEqual({ action: 'migrate', reason: 'alias', target: to });
    }
  });

  it('flags unrecognised kinds', () => {
    expect(classifyRow(' mystery ')).toEqual({ action: 'flag', reason: 'unrecognised' });
    expect(classifyRow('')).toEqual({ action: 'flag', reason: 'unrecognised' });
  });
});

describe('runJanitor', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE terminals (
        id TEXT PRIMARY KEY,
        agent_kind TEXT,
        updated_at INTEGER
      )
    `);
  });

  afterEach(() => {
    db.close();
  });

  it('counts empty table', () => {
    const { stats, flags } = runJanitor(db, { apply: false });
    expect(stats).toEqual({ migrated: 0, flagged: 0, preserved: 0, skipped: 0 });
    expect(flags).toEqual([]);
  });

  it('preserves canonical rows', () => {
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t1', 'claude_code');
    const { stats, flags } = runJanitor(db, { apply: false });
    expect(stats.preserved).toBe(1);
    expect(flags).toEqual([]);
  });

  it('migrates alias rows when apply=true', () => {
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t1', 'codex');
    const { stats, flags } = runJanitor(db, { apply: true });
    expect(stats.migrated).toBe(1);
    expect(flags).toEqual([]);
    const row = db.prepare(`SELECT agent_kind FROM terminals WHERE id = ?`).get('t1');
    expect(row.agent_kind).toBe('codex_cli');
  });

  it('flags unknown rows', () => {
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t1', 'mystery');
    const { stats, flags } = runJanitor(db, { apply: false });
    expect(stats.flagged).toBe(1);
    expect(flags).toEqual([{ id: 't1', agent_kind: 'mystery', reason: 'unrecognised' }]);
  });

  it('skips null agent_kind', () => {
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t1', null);
    const { stats } = runJanitor(db, { apply: false });
    expect(stats.skipped).toBe(1);
  });

  it('handles mixed rows', () => {
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t1', 'claude_code');
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t2', 'codex');
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t3', null);
    db.prepare(`INSERT INTO terminals (id, agent_kind) VALUES (?, ?)`).run('t4', 'mystery');
    const { stats, flags } = runJanitor(db, { apply: true });
    expect(stats.preserved).toBe(1);
    expect(stats.migrated).toBe(1);
    expect(stats.skipped).toBe(1);
    expect(stats.flagged).toBe(1);
    expect(flags.length).toBe(1);
  });
});
