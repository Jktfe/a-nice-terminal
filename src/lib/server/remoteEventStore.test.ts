// Tests for remoteEventStore (M4 Remote ANT T1).
// Per gate bars: stored status is accepted | quarantined ONLY (no
// rejected); replay collision → quarantine deterministically.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from './db';
import {
  appendEvent,
  markAck,
  markDelivered,
  listForMapping,
  listQuarantineForMapping,
  listQuarantineAll,
  findById
} from './remoteEventStore';
import { createAdmission } from './remoteAdmissionStore';
import { createMapping } from './remoteMappingStore';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

let labelCounter = 0;
function freshMappingId(roomId: string = 'room-x'): string {
  const adm = createAdmission({ roomId, lifetimePreset: '48h' });
  labelCounter += 1;
  const mapping = createMapping({
    roomId, remoteInstanceLabel: `lbl-${labelCounter}`,
    admissionId: adm.admission.id, lifetimePreset: '48h',
    expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  });
  return mapping.mapping.id;
}

function append(mappingId: string, overrides: Partial<{
  direction: 'in' | 'out'; kind: string; payloadJson: string; replaySignature: string;
}> = {}) {
  return appendEvent({
    mappingId,
    direction: overrides.direction ?? 'in',
    kind: overrides.kind ?? 'message',
    payloadJson: overrides.payloadJson ?? JSON.stringify({ body: 'hello' }),
    replaySignature: overrides.replaySignature ?? 'sig-1'
  });
}

describe('appendEvent — first occurrence accepted', () => {
  it('stores with status=accepted + status_reason=null + delivery_state=pending', () => {
    const mid = freshMappingId();
    const result = append(mid);
    expect(result.event.status).toBe('accepted');
    expect(result.event.status_reason).toBeNull();
    expect(result.event.delivery_state).toBe('pending');
    expect(result.event.id.startsWith('evt_')).toBe(true);
    expect(result.wasQuarantined).toBe(false);
  });

  it('writes payload_json verbatim', () => {
    const mid = freshMappingId();
    const payload = JSON.stringify({ body: 'hi', meta: { x: 1 } });
    const result = append(mid, { payloadJson: payload });
    expect(result.event.payload_json).toBe(payload);
  });

  it('honours direction in/out enum', () => {
    const mid = freshMappingId();
    expect(append(mid, { direction: 'in' }).event.direction).toBe('in');
    expect(append(mid, { direction: 'out', replaySignature: 'sig-out' }).event.direction).toBe('out');
  });
});

describe('appendEvent — replay collision quarantine', () => {
  it('SECOND append with same (mapping_id, replay_signature) → status=quarantined + status_reason=replay_collision', () => {
    const mid = freshMappingId();
    const first = append(mid, { replaySignature: 'sig-r' });
    const second = append(mid, { replaySignature: 'sig-r' });
    expect(first.event.status).toBe('accepted');
    expect(second.event.status).toBe('quarantined');
    expect(second.event.status_reason).toBe('replay_collision');
    expect(second.wasQuarantined).toBe(true);
  });

  it('different mapping_id with same signature does NOT collide', () => {
    const a = freshMappingId();
    const b = freshMappingId();
    append(a, { replaySignature: 'sig-x' });
    const result = append(b, { replaySignature: 'sig-x' });
    expect(result.event.status).toBe('accepted');
  });

  it('different signature on same mapping_id does NOT collide', () => {
    const mid = freshMappingId();
    append(mid, { replaySignature: 'sig-1' });
    const result = append(mid, { replaySignature: 'sig-2' });
    expect(result.event.status).toBe('accepted');
  });

  it('quarantined event still stored — appears in listQuarantine', () => {
    const mid = freshMappingId();
    append(mid, { replaySignature: 'sig-q' });
    append(mid, { replaySignature: 'sig-q' });
    const quarantined = listQuarantineForMapping(mid);
    expect(quarantined.length).toBe(1);
    expect(quarantined[0].status).toBe('quarantined');
  });

  it('contract Q5: status enum is accepted | quarantined ONLY (never rejected)', () => {
    const mid = freshMappingId();
    const accepted = append(mid, { replaySignature: 'sig-a' });
    const quarantined = append(mid, { replaySignature: 'sig-a' });
    for (const e of [accepted.event, quarantined.event]) {
      expect(['accepted', 'quarantined']).toContain(e.status);
    }
  });
});

describe('markAck', () => {
  it('sets ack_at_ms once; second ack returns false', () => {
    const result = append(freshMappingId());
    expect(markAck(result.event.id)).toBe(true);
    expect(markAck(result.event.id)).toBe(false);
    expect(findById(result.event.id)?.ack_at_ms).not.toBeNull();
  });

  it('returns false for unknown event_id', () => {
    expect(markAck('evt_nope')).toBe(false);
  });
});

describe('markDelivered', () => {
  it('flips delivery_state pending→delivered once', () => {
    const result = append(freshMappingId());
    expect(markDelivered(result.event.id)).toBe(true);
    expect(markDelivered(result.event.id)).toBe(false);
    expect(findById(result.event.id)?.delivery_state).toBe('delivered');
  });
});

describe('listForMapping', () => {
  it('returns all events for the mapping across statuses', () => {
    const mid = freshMappingId();
    const a = append(mid, { replaySignature: 'sig-1' });
    const b = append(mid, { replaySignature: 'sig-2' });
    const c = append(mid, { replaySignature: 'sig-1' });
    const list = listForMapping(mid);
    expect(list.length).toBe(3);
    const ids = new Set(list.map((e) => e.id));
    expect(ids.has(a.event.id)).toBe(true);
    expect(ids.has(b.event.id)).toBe(true);
    expect(ids.has(c.event.id)).toBe(true);
  });

  it('honours limit', () => {
    const mid = freshMappingId();
    for (let i = 0; i < 5; i++) append(mid, { replaySignature: `sig-${i}` });
    expect(listForMapping(mid, 2).length).toBe(2);
  });
});

describe('listQuarantineAll', () => {
  it('returns ONLY quarantined events newest-first', () => {
    const m1 = freshMappingId();
    const m2 = freshMappingId();
    append(m1, { replaySignature: 'a' });
    append(m1, { replaySignature: 'a' });
    append(m2, { replaySignature: 'b' });
    append(m2, { replaySignature: 'b' });
    const all = listQuarantineAll();
    expect(all.length).toBe(2);
    for (const e of all) expect(e.status).toBe('quarantined');
  });
});
