import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { createMapping, findById, revokeMapping } from '$lib/server/remoteMappingStore';
import { POST } from './+server';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

function bridgeReq(token: string, body: unknown): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://x/bridge/messages', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

function newMapping() {
  const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
  return createMapping({
    roomId: 'r1', remoteInstanceLabel: 'inst-b', admissionId: adm.admission.id,
    lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  });
}

const SAMPLE = { kind: 'message', payloadJson: JSON.stringify({ body: 'hi' }), replaySignature: 'sig-1' };

describe('POST /api/remote-ant/bridge/messages', () => {
  it('201 accepted event for valid bearer + body', async () => {
    const m = newMapping();
    const res = await POST(bridgeReq(m.bridgeToken, SAMPLE));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.event.status).toBe('accepted');
    expect(body.event.mapping_id).toBe(m.mapping.id);
  });

  it('touchLastSeen fires AFTER auth resolves', async () => {
    const m = newMapping();
    expect(findById(m.mapping.id)?.last_seen_at_ms).toBeNull();
    await POST(bridgeReq(m.bridgeToken, SAMPLE));
    expect(findById(m.mapping.id)?.last_seen_at_ms).not.toBeNull();
  });

  it('replay signature collision returns quarantined event', async () => {
    const m = newMapping();
    await POST(bridgeReq(m.bridgeToken, SAMPLE));
    const res = await POST(bridgeReq(m.bridgeToken, SAMPLE));
    const body = await res.json();
    expect(body.event.status).toBe('quarantined');
    expect(body.event.status_reason).toBe('replay_collision');
  });

  it('401 missing bearer', async () => {
    await expect(POST({ request: new Request('http://x/bridge/messages', { method: 'POST', body: '{}' }) } as Parameters<typeof POST>[0])).rejects.toMatchObject({ status: 401 });
  });

  it('401 wrong bearer (not rbt_ prefixed)', async () => {
    await expect(POST(bridgeReq('not-a-bridge-token', SAMPLE))).rejects.toMatchObject({ status: 401 });
  });

  it('401 revoked mapping (security: revoked bearer cannot post)', async () => {
    const m = newMapping();
    revokeMapping(m.mapping.id);
    await expect(POST(bridgeReq(m.bridgeToken, SAMPLE))).rejects.toMatchObject({ status: 401 });
  });

  it('413 payload over 64KB', async () => {
    const m = newMapping();
    const huge = 'x'.repeat(65 * 1024);
    await expect(POST(bridgeReq(m.bridgeToken, { ...SAMPLE, payloadJson: huge })))
      .rejects.toMatchObject({ status: 413 });
  });

  it('400 missing kind', async () => {
    const m = newMapping();
    await expect(POST(bridgeReq(m.bridgeToken, { payloadJson: '{}', replaySignature: 'sig' })))
      .rejects.toMatchObject({ status: 400 });
  });

  it('B2 fix: touchLastSeen does NOT bump on body-validation failure', async () => {
    const m = newMapping();
    expect(findById(m.mapping.id)?.last_seen_at_ms).toBeNull();
    await expect(POST(bridgeReq(m.bridgeToken, { payloadJson: '{}', replaySignature: 'sig' })))
      .rejects.toMatchObject({ status: 400 });
    expect(findById(m.mapping.id)?.last_seen_at_ms).toBeNull();
  });

  it('B2 fix: touchLastSeen does NOT bump on payload-too-big 413', async () => {
    const m = newMapping();
    const huge = 'x'.repeat(65 * 1024);
    await expect(POST(bridgeReq(m.bridgeToken, { ...SAMPLE, payloadJson: huge })))
      .rejects.toMatchObject({ status: 413 });
    expect(findById(m.mapping.id)?.last_seen_at_ms).toBeNull();
  });

  it('B2 fix: touchLastSeen DOES bump on quarantined event (counted as successful inbound)', async () => {
    const m = newMapping();
    await POST(bridgeReq(m.bridgeToken, SAMPLE));
    const afterFirst = findById(m.mapping.id)?.last_seen_at_ms;
    await POST(bridgeReq(m.bridgeToken, SAMPLE)); // replay → quarantined
    const afterQuarantine = findById(m.mapping.id)?.last_seen_at_ms;
    expect(afterQuarantine).not.toBeNull();
    expect((afterQuarantine ?? 0)).toBeGreaterThanOrEqual(afterFirst ?? 0);
  });
});
