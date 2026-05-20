import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { POST } from './+server';

const ADMIN_TOKEN = 'admin-test-token';
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

function adminReq(body: unknown, token: string = ADMIN_TOKEN): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://x/admit', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

describe('POST /api/remote-ant/admit', () => {
  it('201 mints code+admission with correct fields', async () => {
    const res = await POST(adminReq({ roomId: 'r1', lifetimePreset: '48h', createdByHandle: '@op' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.code).toMatch(/^ANT-/);
    expect(body.admission.id.startsWith('adm_')).toBe(true);
    expect(body.admission.room_id).toBe('r1');
    expect(body.admission.lifetime_preset).toBe('48h');
  });

  it('401 wrong bearer', async () => {
    await expect(POST(adminReq({ roomId: 'r1', lifetimePreset: '48h' }, 'wrong'))).rejects.toMatchObject({ status: 401 });
  });

  it('400 missing roomId', async () => {
    await expect(POST(adminReq({ lifetimePreset: '48h' }))).rejects.toMatchObject({ status: 400 });
  });

  it('400 bad lifetime_preset', async () => {
    await expect(POST(adminReq({ roomId: 'r1', lifetimePreset: '99years' }))).rejects.toMatchObject({ status: 400 });
  });

  it('400 invalid JSON body', async () => {
    const req = {
      request: new Request('http://x/admit', {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
        body: 'not json'
      })
    } as Parameters<typeof POST>[0];
    await expect(POST(req)).rejects.toMatchObject({ status: 400 });
  });
});
