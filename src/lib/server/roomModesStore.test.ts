import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  getRoomMode,
  getRoomModeRow,
  setRoomMode,
  listModeHistory,
  isAllowedRoomMode,
  ALLOWED_ROOM_MODES
} from './roomModesStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-modes-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('isAllowedRoomMode', () => {
  it('accepts all three canonical modes', () => {
    for (const mode of ALLOWED_ROOM_MODES) expect(isAllowedRoomMode(mode)).toBe(true);
  });
  it('rejects unknown values and wrong types', () => {
    expect(isAllowedRoomMode('mute')).toBe(false);
    expect(isAllowedRoomMode('')).toBe(false);
    expect(isAllowedRoomMode(null)).toBe(false);
    expect(isAllowedRoomMode(42)).toBe(false);
    expect(isAllowedRoomMode(undefined)).toBe(false);
  });
});

describe('getRoomMode default behaviour', () => {
  it('returns brainstorm when no row exists', () => {
    expect(getRoomMode('never-set-room')).toBe('brainstorm');
  });
  it('getRoomModeRow returns null when no row exists', () => {
    expect(getRoomModeRow('never-set-room')).toBeNull();
  });
});

describe('setRoomMode roundtrip', () => {
  it('persists each of the 3 modes and reads them back', () => {
    setRoomMode({ roomId: 'r1', mode: 'brainstorm', set_by: '@a' });
    expect(getRoomMode('r1')).toBe('brainstorm');
    setRoomMode({ roomId: 'r1', mode: 'heads-down', set_by: '@b' });
    expect(getRoomMode('r1')).toBe('heads-down');
    setRoomMode({ roomId: 'r1', mode: 'closed', set_by: '@c' });
    expect(getRoomMode('r1')).toBe('closed');
  });

  it('returns the new row with set_by + set_at populated', () => {
    const row = setRoomMode({ roomId: 'r1', mode: 'heads-down', set_by: '@a' });
    expect(row.room_id).toBe('r1');
    expect(row.mode).toBe('heads-down');
    expect(row.set_by).toBe('@a');
    expect(typeof row.set_at).toBe('number');
    expect(row.set_at).toBeGreaterThan(0);
  });

  it('rooms are independent — flipping one does not affect another', () => {
    setRoomMode({ roomId: 'rA', mode: 'closed', set_by: '@a' });
    setRoomMode({ roomId: 'rB', mode: 'heads-down', set_by: '@a' });
    expect(getRoomMode('rA')).toBe('closed');
    expect(getRoomMode('rB')).toBe('heads-down');
  });

  it('null set_by is allowed and persisted', () => {
    const row = setRoomMode({ roomId: 'r1', mode: 'brainstorm', set_by: null });
    expect(row.set_by).toBeNull();
  });
});

describe('chat_room_mode_history append-only audit log', () => {
  it('appends one row per setRoomMode call (never UPDATEs)', () => {
    setRoomMode({ roomId: 'r1', mode: 'brainstorm', set_by: '@a' });
    setRoomMode({ roomId: 'r1', mode: 'heads-down', set_by: '@b' });
    setRoomMode({ roomId: 'r1', mode: 'closed', set_by: '@c' });
    setRoomMode({ roomId: 'r1', mode: 'brainstorm', set_by: '@a' });
    const history = listModeHistory('r1');
    expect(history.length).toBe(4);
  });

  it('previous_mode is null on the first ever flip', () => {
    setRoomMode({ roomId: 'r1', mode: 'heads-down', set_by: '@a' });
    const history = listModeHistory('r1');
    expect(history[0].previous_mode).toBeNull();
    expect(history[0].mode).toBe('heads-down');
  });

  it('previous_mode reflects the mode before each flip', () => {
    setRoomMode({ roomId: 'r1', mode: 'brainstorm', set_by: '@a' });
    setRoomMode({ roomId: 'r1', mode: 'heads-down', set_by: '@b' });
    setRoomMode({ roomId: 'r1', mode: 'closed', set_by: '@c' });
    const history = listModeHistory('r1');
    expect(history.map((row) => row.previous_mode)).toEqual([
      'heads-down', 'brainstorm', null
    ]);
    expect(history.map((row) => row.mode)).toEqual([
      'closed', 'heads-down', 'brainstorm'
    ]);
  });

  it('history is scoped per room', () => {
    setRoomMode({ roomId: 'rA', mode: 'closed', set_by: '@a' });
    setRoomMode({ roomId: 'rB', mode: 'closed', set_by: '@a' });
    expect(listModeHistory('rA').length).toBe(1);
    expect(listModeHistory('rB').length).toBe(1);
  });

  it('listModeHistory honours the limit parameter', () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      setRoomMode({ roomId: 'r1', mode: 'brainstorm', set_by: '@a' });
    }
    expect(listModeHistory('r1', 2).length).toBe(2);
    expect(listModeHistory('r1', 100).length).toBe(5);
  });

  it('current-row table stays at one row per room even after many flips', () => {
    setRoomMode({ roomId: 'r1', mode: 'brainstorm', set_by: '@a' });
    setRoomMode({ roomId: 'r1', mode: 'heads-down', set_by: '@b' });
    setRoomMode({ roomId: 'r1', mode: 'closed', set_by: '@c' });
    expect(getRoomModeRow('r1')?.mode).toBe('closed');
  });
});
