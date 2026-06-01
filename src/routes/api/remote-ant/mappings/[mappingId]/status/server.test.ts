// Route tests for /api/remote-ant/mappings/:mappingId/status (M4 v2 count surface).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { createMapping, revokeMapping } from '$lib/server/remoteMappingStore';
import { appendEvent, markDelivered } from '$lib/server/remoteEventStore';
import { GET } from './+server';

const ADMIN_TOKEN = 'admin-v2-status-tok';
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

let labelCounter = 0;
function newMapping(): { mappingId: string } {
  const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
  labelCounter += 1;
  const result = createMapping({
    roomId: 'r1', remoteInstanceLabel: `lbl-${labelCounter}`, admissionId: adm.admission.id,
    lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  });
  return { mappingId: result.mapping.id };
}

function statusReq(mappingId: string, token: string = ADMIN_TOKEN): Parameters<typeof GET>[0] {
  return {
    request: new Request(`http://x/api/remote-ant/mappings/${mappingId}/status`, {
      headers: { authorization: `Bearer ${token}` }
    }),
    params: { mappingId }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/remote-ant/mappings/:mappingId/status (M4 v2 count surface)', () => {
  it('200 zero-counts for fresh mapping with no events', async () => {
    const { mappingId } = newMapping();
    const res = await GET(statusReq(mappingId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mapping.id).toBe(mappingId);
    expect(body.counts).toEqual({ accepted: 0, quarantined: 0, delivered: 0, pending: 0, failed: 0 });
  });

  it('200 happy with counts populated by status + delivery_state', async () => {
    const { mappingId } = newMapping();
    appendEvent({ mappingId, direction: 'in', kind: 'message', payloadJson: '{}', replaySignature: 's1' });
    appendEvent({ mappingId, direction: 'in', kind: 'message', payloadJson: '{}', replaySignature: 's2' });
    appendEvent({ mappingId, direction: 'in', kind: 'message', payloadJson: '{}', replaySignature: 's1' }); // replay → quarantined
    const ev = appendEvent({ mappingId, direction: 'in', kind: 'message', payloadJson: '{}', replaySignature: 's3' });
    markDelivered(ev.event.id);
    const res = await GET(statusReq(mappingId));
    const body = await res.json();
    expect(body.counts.accepted).toBe(3);
    expect(body.counts.quarantined).toBe(1);
    expect(body.counts.delivered).toBe(1);
    expect(body.counts.pending).toBe(3);
    expect(body.counts.failed).toBe(0);
  });

  it('does NOT return token bytes in mapping payload', async () => {
    const { mappingId } = newMapping();
    const res = await GET(statusReq(mappingId));
    const body = await res.json();
    expect(body.mapping).not.toHaveProperty('bridge_token');
    expect(body.mapping).not.toHaveProperty('bridge_token_hash');
  });

  it('401 wrong admin-bearer', async () => {
    const { mappingId } = newMapping();
    await expect(GET(statusReq(mappingId, 'wrong'))).rejects.toMatchObject({ status: 401 });
  });

  it('404 unknown mapping', async () => {
    await expect(GET(statusReq('map_nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('404 revoked mapping (operator cannot inspect through revoked)', async () => {
    const { mappingId } = newMapping();
    revokeMapping(mappingId);
    await expect(GET(statusReq(mappingId))).rejects.toMatchObject({ status: 404 });
  });
});
