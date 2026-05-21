import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createAdmission } from '$lib/server/remoteAdmissionStore';
import { createMapping } from '$lib/server/remoteMappingStore';
import { appendEvent, findById } from '$lib/server/remoteEventStore';
import { GET, POST } from './+server';

const ADMIN_TOKEN = 'admin-q-tok';
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
function newMapping(roomId: string = 'r-q'): string {
  const adm = createAdmission({ roomId, lifetimePreset: '48h' });
  labelCounter += 1;
  return createMapping({
    roomId, remoteInstanceLabel: `qlbl-${labelCounter}`, admissionId: adm.admission.id,
    lifetimePreset: '48h', expiresAtMs: Date.now() + 48 * 60 * 60 * 1000
  }).mapping.id;
}

function quarantine(mappingId: string, sig: string): string {
  appendEvent({ mappingId, direction: 'in', kind: 'message', payloadJson: '{}', replaySignature: sig });
  return appendEvent({ mappingId, direction: 'in', kind: 'message', payloadJson: '{}', replaySignature: sig }).event.id;
}

function getReq(qs: string = ''): Parameters<typeof GET>[0] {
  const url = `http://x/quarantine${qs}`;
  return {
    request: new Request(url, { headers: { authorization: `Bearer ${ADMIN_TOKEN}` } }),
    url: new URL(url)
  } as Parameters<typeof GET>[0];
}

function postReq(eventId: string): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://x/quarantine', {
      method: 'POST',
      headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify({ eventId })
    })
  } as Parameters<typeof POST>[0];
}

describe('GET /api/remote-ant/quarantine', () => {
  it('200 returns ALL quarantined events when no mappingId param', async () => {
    const m1 = newMapping();
    const m2 = newMapping();
    quarantine(m1, 'sig-1');
    quarantine(m2, 'sig-2');
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.events.length).toBe(2);
    for (const e of body.events) expect(e.status).toBe('quarantined');
  });

  it('200 filters by mappingId when set', async () => {
    const m1 = newMapping();
    const m2 = newMapping();
    quarantine(m1, 'sig-1');
    quarantine(m2, 'sig-2');
    const res = await GET(getReq(`?mappingId=${m1}`));
    const body = await res.json();
    expect(body.events.length).toBe(1);
    expect(body.events[0].mapping_id).toBe(m1);
  });

  it('401 wrong bearer', async () => {
    const url = 'http://x/quarantine';
    const req = {
      request: new Request(url, { headers: { authorization: 'Bearer wrong' } }),
      url: new URL(url)
    } as Parameters<typeof GET>[0];
    await expect(GET(req)).rejects.toMatchObject({ status: 401 });
  });
});

describe('POST /api/remote-ant/quarantine (operator ack)', () => {
  it('200 acks a quarantined event once', async () => {
    const m = newMapping();
    const eventId = quarantine(m, 'sig-ack');
    const res = await POST(postReq(eventId));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.acked).toBe(true);
    expect(findById(eventId)?.ack_at_ms).not.toBeNull();
  });

  it('404 second ack', async () => {
    const m = newMapping();
    const eventId = quarantine(m, 'sig-ack2');
    await POST(postReq(eventId));
    await expect(POST(postReq(eventId))).rejects.toMatchObject({ status: 404 });
  });

  it('400 missing eventId', async () => {
    const req = {
      request: new Request('http://x/quarantine', {
        method: 'POST',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, 'content-type': 'application/json' },
        body: '{}'
      })
    } as Parameters<typeof POST>[0];
    await expect(POST(req)).rejects.toMatchObject({ status: 400 });
  });
});
