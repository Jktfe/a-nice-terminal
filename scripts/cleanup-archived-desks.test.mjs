/**
 * cleanup-archived-desks tests — the cleanANT archived-desk removal. Asserts
 * the keep/delete split (live tmux + explicit --keep are kept), that deletion
 * soft-deletes the linked room and hard-deletes the desk (terminals +
 * terminal_records), preserves chat messages, and logs to audit_events.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  computeSets,
  listDeskRecords,
  applyDeskDeletion,
  liveTmuxSessions
} from './cleanup-archived-desks.mjs';

let db;
let tmpDir;

function createSchema() {
  db.exec(`
    CREATE TABLE terminals (id TEXT PRIMARY KEY, name TEXT);
    CREATE TABLE chat_rooms (
      id TEXT PRIMARY KEY, name TEXT,
      archived_at_ms INTEGER, deleted_at_ms INTEGER
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY, room_id TEXT, author_handle TEXT, body TEXT
    );
    CREATE TABLE terminal_records (
      session_id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      handle TEXT,
      linked_chat_room_id TEXT,
      superseded_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL DEFAULT 0,
      updated_at_ms INTEGER NOT NULL DEFAULT 0
    );
    -- v0.2 audit_events shape (matches prod: audit_id PK + at_ms, no actor_handle)
    CREATE TABLE audit_events (
      audit_id TEXT PRIMARY KEY,
      at_ms INTEGER NOT NULL,
      kind TEXT NOT NULL, entity_kind TEXT NOT NULL, entity_id TEXT NOT NULL,
      actor_agent_id TEXT, actor_runtime_id TEXT,
      before_json TEXT, after_json TEXT
    );
  `);
}

function seedDesk(sessionId, { name = sessionId, handle = null, roomId = null } = {}) {
  if (roomId) {
    db.prepare(`INSERT INTO chat_rooms (id, name) VALUES (?, ?)`).run(roomId, roomId);
    db.prepare(`INSERT INTO terminals (id, name) VALUES (?, ?)`).run(sessionId, name);
  }
  db.prepare(
    `INSERT INTO terminal_records (session_id, name, handle, linked_chat_room_id) VALUES (?, ?, ?, ?)`
  ).run(sessionId, name, handle, roomId);
}

beforeEach(() => {
  db = new Database(':memory:');
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-cleanup-desks-'));
  createSchema();
});

afterEach(() => {
  db.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('liveTmuxSessions', () => {
  it('parses session names from the tmux runner output', () => {
    const set = liveTmuxSessions(() => 't_aaa\nt_bbb\n\n  t_ccc  \n');
    expect([...set].sort()).toEqual(['t_aaa', 't_bbb', 't_ccc']);
  });

  it('returns an empty set when tmux output is empty (no server)', () => {
    expect(liveTmuxSessions(() => '').size).toBe(0);
  });
});

describe('computeSets', () => {
  it('keeps desks whose session is live in tmux, deletes the rest', () => {
    const records = [
      { session_id: 't_live', name: 'Live' },
      { session_id: 't_dead', name: 'Dead' }
    ];
    const { keep, del } = computeSets(records, new Set(['t_live']));
    expect(keep.map((r) => r.session_id)).toEqual(['t_live']);
    expect(del.map((r) => r.session_id)).toEqual(['t_dead']);
  });

  it('honours an explicit extra-keep set even when not live', () => {
    const records = [
      { session_id: 't_live', name: 'Live' },
      { session_id: 't_pin', name: 'Pinned' },
      { session_id: 't_dead', name: 'Dead' }
    ];
    const { keep, del } = computeSets(records, new Set(['t_live']), new Set(['t_pin']));
    expect(keep.map((r) => r.session_id).sort()).toEqual(['t_live', 't_pin']);
    expect(del.map((r) => r.session_id)).toEqual(['t_dead']);
  });
});

describe('applyDeskDeletion', () => {
  it('soft-deletes the linked room and hard-deletes the desk rows', () => {
    seedDesk('t_keep', { name: 'Keep', handle: '@keep', roomId: 'r_keep' });
    seedDesk('t_gone', { name: 'Gone', handle: '@gone', roomId: 'r_gone' });
    db.prepare(`INSERT INTO chat_messages (id, room_id, author_handle, body) VALUES ('m1','r_gone','@gone','hi')`).run();

    const records = listDeskRecords(db);
    const { del } = computeSets(records, new Set(['t_keep']));
    const n = applyDeskDeletion(db, del, 9000);
    expect(n).toBe(1);

    // Desk gone from both tables.
    expect(db.prepare(`SELECT 1 FROM terminal_records WHERE session_id='t_gone'`).get()).toBeUndefined();
    expect(db.prepare(`SELECT 1 FROM terminals WHERE id='t_gone'`).get()).toBeUndefined();
    // Linked room soft-deleted (not removed); kept desk + its room untouched.
    expect(db.prepare(`SELECT deleted_at_ms FROM chat_rooms WHERE id='r_gone'`).get().deleted_at_ms).toBe(9000);
    expect(db.prepare(`SELECT 1 FROM terminal_records WHERE session_id='t_keep'`).get()).toBeDefined();
    expect(db.prepare(`SELECT deleted_at_ms FROM chat_rooms WHERE id='r_keep'`).get().deleted_at_ms).toBeNull();
    // Chat messages preserved (room only soft-deleted).
    expect(db.prepare(`SELECT COUNT(*) c FROM chat_messages WHERE room_id='r_gone'`).get().c).toBe(1);
  });

  it('logs one audit_events row per deleted desk', () => {
    seedDesk('t_a', { roomId: 'r_a' });
    seedDesk('t_b', { roomId: 'r_b' });
    const { del } = computeSets(listDeskRecords(db), new Set());
    applyDeskDeletion(db, del, 9000);
    const audit = db.prepare(`SELECT kind, entity_id FROM audit_events ORDER BY entity_id`).all();
    expect(audit).toHaveLength(2);
    expect(audit[0].kind).toBe('terminal_record.desk_deleted');
  });

  it('handles desks with no linked room', () => {
    seedDesk('t_noroom', { name: 'NoRoom' });
    const { del } = computeSets(listDeskRecords(db), new Set());
    expect(del.map((r) => r.session_id)).toEqual(['t_noroom']);
    const n = applyDeskDeletion(db, del, 9000);
    expect(n).toBe(1);
    expect(db.prepare(`SELECT 1 FROM terminal_records WHERE session_id='t_noroom'`).get()).toBeUndefined();
  });

  it('returns 0 when nothing to delete', () => {
    expect(applyDeskDeletion(db, [], 9000)).toBe(0);
  });
});
