import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { createMapping, revokeMapping } from '$lib/server/remoteMappingStore';
import { listForMapping } from '$lib/server/remoteEventStore';
import { POST } from './+server';

const ADMIN_TOKEN = 'admin-send-tok';
const PREV = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});

function sendReq(mappingId: string, body: unknown, token: string = ADMIN_TOKEN): Parameters<typeof POST>[0] {
  return {
    request: new Request(`http://x/mappings/${mappingId}/send`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    params: { mappingId }
  } as unknown as Parameters<typeof POST>[0];
}

function newMapping() {
  const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
  return createMapping({
    roomId: 'r1', remoteInstanceLabel: 'inst-out', admissionId: adm.admission.id,
    lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  });
}

const SAMPLE = { kind: 'message', payloadJson: JSON.stringify({ body: 'outbound hi' }) };

describe('POST /api/remote-ant/mappings/:mappingId/send (T2.5 local→remote)', () => {
  it('201 queues an OUT-direction event for the mapping', async () => {
    const m = newMapping();
    const res = await POST(sendReq(m.mapping.id, SAMPLE));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.event.direction).toBe('out');
    expect(body.event.status).toBe('accepted');
    expect(body.event.mapping_id).toBe(m.mapping.id);
    const events = listForMapping(m.mapping.id);
    expect(events.length).toBe(1);
    expect(events[0].direction).toBe('out');
  });

  it('honours explicit replaySignature', async () => {
    const m = newMapping();
    const res = await POST(sendReq(m.mapping.id, { ...SAMPLE, replaySignature: 'op-sig-1' }));
    expect(res.status).toBe(201);
  });

  it('401 wrong admin-bearer (NOT bridge bearer)', async () => {
    const m = newMapping();
    await expect(POST(sendReq(m.mapping.id, SAMPLE, 'wrong'))).rejects.toMatchObject({ status: 401 });
  });

  it('404 unknown mapping', async () => {
    await expect(POST(sendReq('map_nope', SAMPLE))).rejects.toMatchObject({ status: 404 });
  });

  it('404 revoked mapping (operator cannot send through revoked bridge)', async () => {
    const m = newMapping();
    revokeMapping(m.mapping.id);
    await expect(POST(sendReq(m.mapping.id, SAMPLE))).rejects.toMatchObject({ status: 404 });
  });

  it('413 payloadJson over 64KB', async () => {
    const m = newMapping();
    const huge = 'x'.repeat(65 * 1024);
    await expect(POST(sendReq(m.mapping.id, { ...SAMPLE, payloadJson: huge })))
      .rejects.toMatchObject({ status: 413 });
  });

  it('400 missing kind', async () => {
    const m = newMapping();
    await expect(POST(sendReq(m.mapping.id, { payloadJson: '{}' })))
      .rejects.toMatchObject({ status: 400 });
  });

  it('does NOT bump touchLastSeen (out-direction is operator-initiated, not inbound)', async () => {
    // touchLastSeen is reserved for INBOUND bridge events per contract Q1.
    // Verify that send route does not call it.
    const m = newMapping();
    await POST(sendReq(m.mapping.id, SAMPLE));
    // fresh fetch — last_seen_at_ms should still be null since this was OUT.
    const { findById } = await import('$lib/server/remoteMappingStore');
    expect(findById(m.mapping.id)?.last_seen_at_ms).toBeNull();
  });
});
