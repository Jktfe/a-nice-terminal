import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  bindHandle,
  getHandleRow,
  getLiveBinding,
  getLiveBindingByPane,
  listLiveBindings,
  listHandlesOwnedBy,
  setPaneResolverForTests,
  tombstoneBinding,
  tombstoneBindingsForPane, sweepExpiredProxyBindings } from './handleBindingsStore';
import { listLedger } from './identityLedgerStore';

let tmpDir: string;
const prev = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-handle-bindings-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
});

afterEach(() => {
  setPaneResolverForTests(null);
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prev === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prev;
});

describe('listHandlesOwnedBy — owned-handles-only (JWPK + fClaude 2026-06-12)', () => {
  it('returns only handles the owner is in owners[] of', () => {
    const db = getIdentityDb();
    const ins = db.prepare(`INSERT INTO handles (handle, owners, created_at_ms) VALUES (?, ?, 0)`);
    ins.run('@mine1', '["@JWPK"]');
    ins.run('@mine2', '["@someone","@JWPK"]');
    ins.run('@nope', '["@someone"]');
    ins.run('@noowner', null);
    expect(listHandlesOwnedBy('@JWPK').map((h) => h.handle).sort()).toEqual(['@mine1', '@mine2']);
    expect(listHandlesOwnedBy('@someone').map((h) => h.handle).sort()).toEqual(['@mine2', '@nope']);
  });

  it('excludes deleted handles', () => {
    const db = getIdentityDb();
    db.prepare(`INSERT INTO handles (handle, owners, lifecycle, created_at_ms) VALUES (?, ?, ?, 0)`)
      .run('@gone', '["@JWPK"]', 'deleted');
    expect(listHandlesOwnedBy('@JWPK')).toHaveLength(0);
  });
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

  it('stores canonical tmux pane ids when a writer passes a target alias', () => {
    setPaneResolverForTests((pane) => (pane === 't_antqwen:0.0' ? '%81' : null));
    const row = bindHandle({
      handle: '@antqwen',
      pane: 't_antqwen:0.0',
      pid: 19100,
      pidStart: '2026-06-19T15:00:31.000Z',
      terminalId: 't_oxls01slci'
    });
    expect(row.pane).toBe('%81');
    expect(getLiveBinding('@antqwen')?.pane).toBe('%81');
    expect(getLiveBindingByPane('t_antqwen:0.0')?.handle).toBe('@antqwen');
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

  it('reclaiming a VACANT handle with owners ledgers an owner notification (claims are loud)', () => {
    bindHandle({ handle: '@dave', pane: '%1', pid: 1, pidStart: null });
    getIdentityDb()
      .prepare(`UPDATE handles SET owners = ? WHERE handle = ?`)
      .run(JSON.stringify(['@JWPK', '@extracheck']), '@dave');
    tombstoneBinding('@dave', 'pane-not-found');
    bindHandle({ handle: '@dave', pane: '%2', pid: 2, pidStart: null });
    const notifies = listLedger({ handle: '@dave' }).filter((e) => e.kind === 'owner.notified');
    expect(notifies).toHaveLength(1);
    expect(notifies[0].detail).toMatchObject({
      reason: 'vacant-claim',
      owners: ['@JWPK', '@extracheck'],
      pane: '%2'
    });
  });

  it('a first-ever claim (no vacancy, no owners) does not ledger a notification', () => {
    bindHandle({ handle: '@fresh', pane: '%3', pid: 3, pidStart: null });
    expect(listLedger({ handle: '@fresh' }).filter((e) => e.kind === 'owner.notified')).toHaveLength(0);
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

// fClaude's punch-list (msg_vdq378hblc): proxy bindings — bound with NO pane,
// so no observation witness can ever end them — were immortal. They are
// assertions, not observations, so they DECAY: unrenewed past the TTL they
// tombstone. Pane-witnessed bindings are untouched (the pane diff owns those).
describe('sweepExpiredProxyBindings — the proxy death-witness', () => {
  it('tombstones a pane-less binding older than the TTL, with reason + ledger', () => {
    bindHandle({ handle: '@proxy', pane: null, pid: 0, pidStart: null, atMs: 1000 });
    const swept = sweepExpiredProxyBindings(60_000, 1000 + 60_001);
    expect(swept).toEqual(['@proxy']);
    expect(getLiveBinding('@proxy')).toBeNull();
    const rows = listLedger({ handle: '@proxy' }).filter((e) => e.kind === 'binding.tombstoned');
    expect(rows.length).toBeGreaterThan(0);
  });

  it('leaves fresh proxy bindings and ALL pane-witnessed bindings alone', () => {
    bindHandle({ handle: '@freshproxy', pane: null, pid: 0, pidStart: null, atMs: 5000 });
    bindHandle({ handle: '@olddesk', pane: '%9', pid: 9, pidStart: null, atMs: 0 });
    const swept = sweepExpiredProxyBindings(60_000, 5000 + 30_000);
    expect(swept).toEqual([]);
    expect(getLiveBinding('@freshproxy')).not.toBeNull();
    expect(getLiveBinding('@olddesk')).not.toBeNull(); // ancient but pane-witnessed: not ours to kill
  });

  it('re-binding renews the clock (supersede + fresh row survives)', () => {
    bindHandle({ handle: '@renewed', pane: null, pid: 0, pidStart: null, atMs: 1000 });
    bindHandle({ handle: '@renewed', pane: null, pid: 0, pidStart: null, atMs: 100_000 });
    const swept = sweepExpiredProxyBindings(60_000, 130_000);
    expect(swept).toEqual([]);
    expect(getLiveBinding('@renewed')).not.toBeNull();
  });
});
