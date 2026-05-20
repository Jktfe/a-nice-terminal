import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { createMapping, revokeMapping } from '$lib/server/remoteMappingStore';
import { GET } from './+server';

const ADMIN_TOKEN = 'admin-list-tok';
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

function getReq(roomId: string, token: string = ADMIN_TOKEN): Parameters<typeof GET>[0] {
  return {
    request: new Request(`http://x/mappings?roomId=${roomId}`, {
      headers: { authorization: `Bearer ${token}` }
    }),
    url: new URL(`http://x/mappings?roomId=${roomId}`)
  } as Parameters<typeof GET>[0];
}

function newMapping(roomId: string, label: string) {
  const adm = createAdmission({ roomId, lifetimePreset: '48h' });
  return createMapping({
    roomId, remoteInstanceLabel: label, admissionId: adm.admission.id,
    lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  });
}

describe('GET /api/remote-ant/mappings', () => {
  it('200 lists active mappings for room; excludes revoked', async () => {
    const a = newMapping('r1', 'inst-a');
    const b = newMapping('r1', 'inst-b');
    revokeMapping(b.mapping.id);
    const res = await GET(getReq('r1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mappings.map((m: { id: string }) => m.id)).toEqual([a.mapping.id]);
  });

  it('does NOT return token bytes', async () => {
    newMapping('r1', 'inst-a');
    const res = await GET(getReq('r1'));
    const body = await res.json();
    for (const m of body.mappings) {
      expect(m).not.toHaveProperty('bridge_token');
      expect(m).not.toHaveProperty('bridge_token_hash');
    }
  });

  it('400 missing roomId', async () => {
    const req = {
      request: new Request('http://x/mappings', { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }),
      url: new URL('http://x/mappings')
    } as Parameters<typeof GET>[0];
    await expect(GET(req)).rejects.toMatchObject({ status: 400 });
  });

  it('401 wrong bearer', async () => {
    await expect(GET(getReq('r1', 'wrong'))).rejects.toMatchObject({ status: 401 });
  });
});
