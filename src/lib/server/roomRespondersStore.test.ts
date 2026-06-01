import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from './db';
import { upsertTerminal } from './terminalsStore';
import {
  listRespondersForRoom,
  setResponders,
  addResponder,
  removeResponder,
  moveResponder,
  compactRoom
} from './roomRespondersStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-responders-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

function mkTerm(name: string): string {
  return upsertTerminal({ pid: 100, pid_start: 'ps', name }).id;
}

describe('listRespondersForRoom default + setResponders roundtrip', () => {
  it('returns empty array when no rows exist', () => {
    expect(listRespondersForRoom('r1')).toEqual([]);
  });

  it('PUT replace-all writes rows at 1000, 2000, 3000 in order', () => {
    const [a, b, c] = [mkTerm('a'), mkTerm('b'), mkTerm('c')];
    const rows = setResponders({ roomId: 'r1', terminalIds: [a, b, c], set_by: '@admin' });
    expect(rows.map((row) => row.order_index)).toEqual([1000, 2000, 3000]);
    expect(rows.map((row) => row.terminal_id)).toEqual([a, b, c]);
    expect(rows.every((row) => row.set_by === '@admin')).toBe(true);
  });

  it('PUT replace-all clears prior rows', () => {
    const [a, b, c, d] = ['a', 'b', 'c', 'd'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a, b, c], set_by: '@x' });
    setResponders({ roomId: 'r1', terminalIds: [d], set_by: '@y' });
    const rows = listRespondersForRoom('r1');
    expect(rows.length).toBe(1);
    expect(rows[0].terminal_id).toBe(d);
    expect(rows[0].order_index).toBe(1000);
  });
});

describe('addResponder', () => {
  it('appends with no --at: order_index = max + 1000', () => {
    const [a, b] = ['a', 'b'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a], set_by: '@x' });
    const added = addResponder({ roomId: 'r1', terminalId: b, set_by: '@y' });
    expect(added.order_index).toBe(2000);
  });

  it('insertAt(N) midpoint between neighbors', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a, b], set_by: '@x' });
    const added = addResponder({ roomId: 'r1', terminalId: c, at: 1, set_by: '@y' });
    expect(added.order_index).toBe(1500);
    expect(listRespondersForRoom('r1').map((row) => row.terminal_id)).toEqual([a, c, b]);
  });

  it('insertAt(0) uses midpoint between 0 and first', () => {
    const [a, b] = ['a', 'b'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a], set_by: '@x' });
    const added = addResponder({ roomId: 'r1', terminalId: b, at: 0, set_by: '@y' });
    expect(added.order_index).toBe(500);
    expect(listRespondersForRoom('r1').map((row) => row.terminal_id)).toEqual([b, a]);
  });

  it('insertAt with collapsed gap triggers compact-then-retry', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(mkTerm);
    const db = getIdentityDb();
    db.prepare(`INSERT INTO chat_room_responders (room_id, terminal_id, order_index, set_by, set_at) VALUES (?, ?, ?, ?, ?)`).run('r1', a, 1000, '@x', 1);
    db.prepare(`INSERT INTO chat_room_responders (room_id, terminal_id, order_index, set_by, set_at) VALUES (?, ?, ?, ?, ?)`).run('r1', b, 1001, '@x', 1);
    addResponder({ roomId: 'r1', terminalId: c, at: 1, set_by: '@y' });
    const rows = listRespondersForRoom('r1');
    expect(rows.map((row) => row.terminal_id)).toEqual([a, c, b]);
    expect(rows.every((row) => row.order_index > 0)).toBe(true);
    expect(new Set(rows.map((row) => row.order_index)).size).toBe(3);
  });
});

describe('removeResponder', () => {
  it('removes the row and returns true', () => {
    const [a, b] = ['a', 'b'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a, b], set_by: '@x' });
    expect(removeResponder('r1', a)).toBe(true);
    const rows = listRespondersForRoom('r1');
    expect(rows.length).toBe(1);
    expect(rows[0].terminal_id).toBe(b);
    expect(rows[0].order_index).toBe(2000);
  });

  it('does NOT reflow remaining rows', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a, b, c], set_by: '@x' });
    removeResponder('r1', b);
    const rows = listRespondersForRoom('r1');
    expect(rows.map((row) => row.order_index)).toEqual([1000, 3000]);
  });

  it('returns false when terminal is not a responder', () => {
    expect(removeResponder('r1', 'phantom-terminal')).toBe(false);
  });
});

describe('moveResponder', () => {
  it('moves a responder forward to a later position', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a, b, c], set_by: '@x' });
    moveResponder({ roomId: 'r1', terminalId: a, to: 2, set_by: '@y' });
    expect(listRespondersForRoom('r1').map((row) => row.terminal_id)).toEqual([b, c, a]);
  });

  it('moves a responder backward to position 0', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(mkTerm);
    setResponders({ roomId: 'r1', terminalIds: [a, b, c], set_by: '@x' });
    moveResponder({ roomId: 'r1', terminalId: c, to: 0, set_by: '@y' });
    expect(listRespondersForRoom('r1').map((row) => row.terminal_id)).toEqual([c, a, b]);
  });
});

describe('compactRoom', () => {
  it('renumbers rows to 1000, 2000, 3000 after sparse history', () => {
    const [a, b, c] = ['a', 'b', 'c'].map(mkTerm);
    const db = getIdentityDb();
    db.prepare(`INSERT INTO chat_room_responders (room_id, terminal_id, order_index, set_by, set_at) VALUES (?, ?, ?, ?, ?)`).run('r1', a, 17, '@x', 1);
    db.prepare(`INSERT INTO chat_room_responders (room_id, terminal_id, order_index, set_by, set_at) VALUES (?, ?, ?, ?, ?)`).run('r1', b, 4200, '@x', 1);
    db.prepare(`INSERT INTO chat_room_responders (room_id, terminal_id, order_index, set_by, set_at) VALUES (?, ?, ?, ?, ?)`).run('r1', c, 4201, '@x', 1);
    const compacted = compactRoom('r1');
    expect(compacted.map((row) => row.order_index)).toEqual([1000, 2000, 3000]);
    expect(compacted.map((row) => row.terminal_id)).toEqual([a, b, c]);
  });
});

describe('per-room isolation', () => {
  it('rooms have independent responder lists', () => {
    const [a, b] = ['a', 'b'].map(mkTerm);
    setResponders({ roomId: 'rA', terminalIds: [a], set_by: '@x' });
    setResponders({ roomId: 'rB', terminalIds: [b], set_by: '@x' });
    expect(listRespondersForRoom('rA').map((row) => row.terminal_id)).toEqual([a]);
    expect(listRespondersForRoom('rB').map((row) => row.terminal_id)).toEqual([b]);
  });
});
