import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  bindHandle,
  getHandleRow,
  getLiveBinding,
  listLiveBindings,
  tombstoneBinding,
  tombstoneBindingsForPane
} from './handleBindingsStore';
import { listLedger } from './identityLedgerStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-handle-bindings-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('handleBindingsStore — bind', () => {
  it('binding a free handle creates one live binding with lineage', () => {
    const row = bindHandle({
      handle: '@dave',
      pane: '%9',
      pid: 1234,
      pidStart: '2026-06-10T20:00:00Z',
      spawnedBy: '@extracheck',
      terminalId: 't_abc'
    });
    expect(row.handle).toBe('@dave');
    expect(row.tombstoned_at_ms).toBeNull();
    const live = getLiveBinding('@dave');
    expect(live?.pane).toBe('%9');
    expect(live?.spawned_by).toBe('@extracheck');
  });

  it('@-normalises the handle on bind and lookup', () => {
    bindHandle({ handle: 'dave', pane: '%1', pid: 1, pidStart: null });
    expect(getLiveBinding('@dave')?.pane).toBe('%1');
  });

  it('rebinding a handle tombstones the prior live row — exactly one live binding per handle', () => {
    bindHandle({ handle: '@dave', pane: '%1', pid: 1, pidStart: null });
    bindHandle({ handle: '@dave', pane: '%2', pid: 2, pidStart: null });
    const live = listLiveBindings().filter((b) => b.handle === '@dave');
    expect(live).toHaveLength(1);
    expect(live[0].pane).toBe('%2');
  });

  it('every bind and rebind appends to the identity ledger', () => {
    bindHandle({ handle: '@dave', pane: '%1', pid: 1, pidStart: null });
    bindHandle({ handle: '@dave', pane: '%2', pid: 2, pidStart: null });
    const events = listLedger({ handle: '@dave' });
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('binding.claimed');
    expect(kinds).toContain('binding.superseded');
  });
});

describe('handleBindingsStore — tombstone', () => {
  it('tombstoneBinding marks the live row dead with a reason and ledgers it', () => {
    bindHandle({ handle: '@dave', pane: '%1', pid: 1, pidStart: null });
    const ok = tombstoneBinding('@dave', 'pane-not-found');
    expect(ok).toBe(true);
    expect(getLiveBinding('@dave')).toBeNull();
    const events = listLedger({ handle: '@dave' });
    expect(events.some((e) => e.kind === 'binding.tombstoned')).toBe(true);
  });

  it('tombstoneBinding on a handle with no live binding is a no-op returning false', () => {
    expect(tombstoneBinding('@ghost', 'pane-not-found')).toBe(false);
  });

  it('bind upserts the durable handles row (vacancy cleared); tombstone marks it vacant', () => {
    bindHandle({ handle: '@dave', pane: '%1', pid: 1, pidStart: null, spawnedBy: '@extracheck' });
    const bound = getHandleRow('@dave');
    expect(bound).not.toBeNull();
    expect(bound?.vacated_at_ms).toBeNull();
    expect(bound?.created_by).toBe('@extracheck');
    tombstoneBinding('@dave', 'pane-not-found');
    const vacant = getHandleRow('@dave');
    expect(vacant?.vacated_at_ms).toBeTypeOf('number');
    // re-bind clears vacancy again — the powercut reclaim flow
    bindHandle({ handle: '@dave', pane: '%2', pid: 2, pidStart: null });
    expect(getHandleRow('@dave')?.vacated_at_ms).toBeNull();
  });

  it('tombstoneBindingsForPane kills every live binding on that pane', () => {
    bindHandle({ handle: '@a', pane: '%7', pid: 1, pidStart: null });
    bindHandle({ handle: '@b', pane: '%7', pid: 2, pidStart: null });
    bindHandle({ handle: '@c', pane: '%8', pid: 3, pidStart: null });
    const count = tombstoneBindingsForPane('%7', 'pane-not-found');
    expect(count).toBe(2);
    expect(getLiveBinding('@a')).toBeNull();
    expect(getLiveBinding('@b')).toBeNull();
    expect(getLiveBinding('@c')?.pane).toBe('%8');
  });
});
