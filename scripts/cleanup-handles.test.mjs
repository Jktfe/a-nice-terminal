/**
 * cleanup-handles helper tests — the keep-set computation and delete-set
 * selection that drive the aggressive handle anonymisation. The deleteHandle
 * primitive itself is tested in src/lib/server/handleLifecycle.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { canon, computeKeepSet, selectDeleteHandles, liveTmuxSessions } from './cleanup-handles.mjs';

let db;

beforeEach(() => {
  db = new Database(':memory:');
  db.exec(`
    CREATE TABLE handles (handle TEXT PRIMARY KEY, lifecycle TEXT);
    CREATE TABLE terminal_records (session_id TEXT PRIMARY KEY, handle TEXT);
    CREATE TABLE chat_messages (id TEXT PRIMARY KEY, author_handle TEXT);
  `);
});
afterEach(() => db.close());

function seedHandle(h, lifecycle = 'active') {
  db.prepare(`INSERT INTO handles (handle, lifecycle) VALUES (?, ?)`).run(h, lifecycle);
}
function seedRecord(session, handle) {
  db.prepare(`INSERT INTO terminal_records (session_id, handle) VALUES (?, ?)`).run(session, handle);
}
function seedPost(id, author) {
  db.prepare(`INSERT INTO chat_messages (id, author_handle) VALUES (?, ?)`).run(id, author);
}

describe('canon', () => {
  it('prefixes a single @ and strips extras/whitespace', () => {
    expect(canon('vera')).toBe('@vera');
    expect(canon('  @@vera ')).toBe('@vera');
  });
});

describe('liveTmuxSessions', () => {
  it('parses non-empty session names', () => {
    expect([...liveTmuxSessions(() => 'a\n b \n\n')].sort()).toEqual(['a', 'b']);
  });
});

describe('computeKeepSet', () => {
  it('keeps operator + reserved + live-desk handles (lowercased)', () => {
    seedRecord('t_live', '@vera');
    seedRecord('t_live2', '@manorcodex');
    seedRecord('t_dead', '@gone');
    const keep = computeKeepSet(db, new Set(['t_live', 't_live2']), ['@you', '@system'], '@JWPK');
    expect(keep.has('@jwpk')).toBe(true);
    expect(keep.has('@you')).toBe(true);
    expect(keep.has('@system')).toBe(true);
    expect(keep.has('@vera')).toBe(true);
    expect(keep.has('@manorcodex')).toBe(true);
    expect(keep.has('@gone')).toBe(false);
  });
});

describe('selectDeleteHandles', () => {
  it('returns non-deleted handles not in the keep-set, with post counts, busiest first', () => {
    seedHandle('@vera');
    seedHandle('@gone');
    seedHandle('@chatty');
    seedHandle('@already', 'deleted');
    seedPost('m1', '@gone');
    seedPost('m2', '@chatty');
    seedPost('m3', '@chatty');

    const keep = new Set(['@vera', '@jwpk']);
    const targets = selectDeleteHandles(db, keep);

    expect(targets.map((t) => t.handle)).toEqual(['@chatty', '@gone']);
    expect(targets[0].posts).toBe(2);
    expect(targets[1].posts).toBe(1);
    // kept + already-deleted excluded
    expect(targets.find((t) => t.handle === '@vera')).toBeUndefined();
    expect(targets.find((t) => t.handle === '@already')).toBeUndefined();
  });

  it('matches the keep-set case-insensitively', () => {
    seedHandle('@Vera');
    const targets = selectDeleteHandles(db, new Set(['@vera']));
    expect(targets).toEqual([]);
  });
});
