import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { POST } from './+server';

function rowCounts(): { mappings: number; remoteTerminals: number; memberships: number } {
  const db = getIdentityDb();
  return {
    mappings: (db.prepare(`SELECT COUNT(*) as n FROM chat_remote_mappings`).get() as { n: number }).n,
    remoteTerminals: (db.prepare(`SELECT COUNT(*) as n FROM terminals WHERE agent_kind = 'remote'`).get() as { n: number }).n,
    memberships: (db.prepare(`SELECT COUNT(*) as n FROM room_memberships`).get() as { n: number }).n
  };
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
});

function makeReq(admissionId: string, body: unknown): Parameters<typeof POST>[0] {
  return {
    request: new Request(`http://x/${admissionId}/redeem`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    }),
    params: { admissionId }
  } as unknown as Parameters<typeof POST>[0];
}

describe('POST /api/remote-ant/admissions/:id/redeem', () => {
  it('201 mints mapping + bridge_token from valid code', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    const res = await POST(makeReq(adm.admission.id, { code: adm.code, remoteInstanceLabel: 'inst-1' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.bridge_token.startsWith('rbt_')).toBe(true);
    expect(body.mapping.id.startsWith('map_')).toBe(true);
    expect(body.mapping.room_id).toBe('r1');
    expect(body.mapping.remote_instance_label).toBe('inst-1');
    expect(body.mapping.direction).toBe('both');
  });

  it('honours direction override', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    const res = await POST(makeReq(adm.admission.id, { code: adm.code, remoteInstanceLabel: 'inst-2', direction: 'in' }));
    const body = await res.json();
    expect(body.mapping.direction).toBe('in');
  });

  it('410 wrong code (admission stays unredeemed)', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    await expect(POST(makeReq(adm.admission.id, { code: 'ANT-WRONG-X', remoteInstanceLabel: 'inst' })))
      .rejects.toMatchObject({ status: 410 });
  });

  it('410 second redeem of same admission', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    await POST(makeReq(adm.admission.id, { code: adm.code, remoteInstanceLabel: 'inst-a' }));
    await expect(POST(makeReq(adm.admission.id, { code: adm.code, remoteInstanceLabel: 'inst-b' })))
      .rejects.toMatchObject({ status: 410 });
  });

  it('410 unknown admission_id', async () => {
    await expect(POST(makeReq('adm_nope', { code: 'ANT-AAA-BBBB', remoteInstanceLabel: 'inst' })))
      .rejects.toMatchObject({ status: 410 });
  });

  it('400 missing code', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    await expect(POST(makeReq(adm.admission.id, { remoteInstanceLabel: 'x' })))
      .rejects.toMatchObject({ status: 400 });
  });

  it('400 missing remoteInstanceLabel', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    await expect(POST(makeReq(adm.admission.id, { code: adm.code })))
      .rejects.toMatchObject({ status: 400 });
  });

  it('400 bad direction enum', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    await expect(POST(makeReq(adm.admission.id, { code: adm.code, remoteInstanceLabel: 'x', direction: 'sideways' })))
      .rejects.toMatchObject({ status: 400 });
  });
});

describe('B1 atomicity — failed redeem MUST NOT leak mapping/terminal/membership rows', () => {
  it('wrong code: row counts unchanged across the rejected call', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    const before = rowCounts();
    await expect(POST(makeReq(adm.admission.id, { code: 'ANT-WRONG-X', remoteInstanceLabel: 'inst' })))
      .rejects.toMatchObject({ status: 410 });
    expect(rowCounts()).toEqual(before);
  });

  it('second redeem of accepted admission: row counts unchanged from first-redeem state', async () => {
    const adm = createAdmission({ roomId: 'r1', lifetimePreset: '48h' });
    await POST(makeReq(adm.admission.id, { code: adm.code, remoteInstanceLabel: 'inst-a' }));
    const after1 = rowCounts();
    await expect(POST(makeReq(adm.admission.id, { code: adm.code, remoteInstanceLabel: 'inst-b' })))
      .rejects.toMatchObject({ status: 410 });
    expect(rowCounts()).toEqual(after1);
  });

  it('unknown admission_id: zero rows created', async () => {
    const before = rowCounts();
    await expect(POST(makeReq('adm_nope', { code: 'ANT-AAA-BBBB', remoteInstanceLabel: 'inst' })))
      .rejects.toMatchObject({ status: 410 });
    expect(rowCounts()).toEqual(before);
  });
});
