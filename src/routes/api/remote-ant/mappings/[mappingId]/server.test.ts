import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { createMapping } from '$lib/server/remoteMappingStore';
import { GET } from './+server';

const ADMIN_TOKEN = 'admin-show-tok';
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

function showReq(mappingId: string, token: string = ADMIN_TOKEN): Parameters<typeof GET>[0] {
  return {
    request: new Request(`http://x/mappings/${mappingId}`, {
      headers: { authorization: `Bearer ${token}` }
    }),
    params: { mappingId }
  } as unknown as Parameters<typeof GET>[0];
}

describe('GET /api/remote-ant/mappings/:mappingId', () => {
  it('200 returns mapping detail without token bytes', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    const m = createMapping({
      roomId: 'r1', remoteInstanceLabel: 'inst-show', admissionId: adm.admission.id,
      lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
    });
    const res = await GET(showReq(m.mapping.id));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mapping.id).toBe(m.mapping.id);
    expect(body.mapping.remote_instance_label).toBe('inst-show');
    expect(body.mapping).not.toHaveProperty('bridge_token');
    expect(body.mapping).not.toHaveProperty('bridge_token_hash');
  });

  it('404 unknown mapping', async () => {
    await expect(GET(showReq('map_nope'))).rejects.toMatchObject({ status: 404 });
  });

  it('401 wrong admin bearer', async () => {
    await expect(GET(showReq('map_nope', 'wrong'))).rejects.toMatchObject({ status: 401 });
  });
});
