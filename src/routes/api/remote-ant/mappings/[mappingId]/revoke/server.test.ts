import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { createMapping, findById } from '$lib/server/remoteMappingStore';
import { POST } from './+server';

const ADMIN_TOKEN = 'admin-revoke-tok';
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

function revokeReq(mappingId: string): Parameters<typeof POST>[0] {
  return {
    request: new Request(`http://x/mappings/${mappingId}/revoke`, {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}` }
    }),
    params: { mappingId }
  } as unknown as Parameters<typeof POST>[0];
}

function newMapping() {
  const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
  return createMapping({
    roomId: 'r1', remoteInstanceLabel: 'inst-rev', admissionId: adm.admission.id,
    lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  });
}

describe('POST /api/remote-ant/mappings/:mappingId/revoke', () => {
  it('200 revokes once + sets revoked_at_ms on the mapping', async () => {
    const m = newMapping();
    const res = await POST(revokeReq(m.mapping.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.revoked).toBe(true);
    expect(body.mapping_id).toBe(m.mapping.id);
    expect(findById(m.mapping.id)?.revoked_at_ms).not.toBeNull();
  });

  it('404 second revoke (already revoked)', async () => {
    const m = newMapping();
    await POST(revokeReq(m.mapping.id));
    await expect(POST(revokeReq(m.mapping.id))).rejects.toMatchObject({ status: 404 });
  });

  it('404 unknown mapping', async () => {
    await expect(POST(revokeReq('map_nope'))).rejects.toMatchObject({ status: 404 });
  });
});
