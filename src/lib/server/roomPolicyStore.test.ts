import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { getRoomPolicy, setRoomPolicy, DEFAULT_ROOM_POLICY } from './roomPolicyStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-policy-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('roomPolicyStore — two-axis policy data', () => {
  it('defaults to join=invite, read=allowed when no policy is set', () => {
    expect(getRoomPolicy('r1')).toEqual(DEFAULT_ROOM_POLICY);
    expect(getRoomPolicy('r1')).toEqual({ joinPolicy: 'invite', readPolicy: 'allowed' });
  });

  it('sets + reads back both axes', () => {
    setRoomPolicy('r1', { joinPolicy: 'open', readPolicy: 'open' });
    expect(getRoomPolicy('r1')).toEqual({ joinPolicy: 'open', readPolicy: 'open' });
  });

  it('merges a partial update — unspecified axis is preserved', () => {
    setRoomPolicy('r1', { joinPolicy: 'open', readPolicy: 'closed' });
    setRoomPolicy('r1', { joinPolicy: 'invite' }); // only join changes
    expect(getRoomPolicy('r1')).toEqual({ joinPolicy: 'invite', readPolicy: 'closed' });
  });

  it('rejects an invalid state', () => {
    // @ts-expect-error invalid state
    expect(() => setRoomPolicy('r1', { joinPolicy: 'public' })).toThrow(/invalid joinPolicy/);
  });
});
