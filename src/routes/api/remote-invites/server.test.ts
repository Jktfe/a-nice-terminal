/**
 * Unit tests for the /api/remote-invites/* Mac-app shim.
 *
 * Covers the 4 acceptance gates per @evolveantswift msg_57o7qyc54b:
 *   1. Bearer-auth'd user can create an invite (POST → 201 + token).
 *   2. antchat://invite?... redeem mints a mapping + bridge_token.
 *   3. Redeemed user lands in the room (mapping has membership row).
 *   4. Revoked invite cannot be used (DELETE → redeem returns 4xx).
 *
 * Plus 401/400/404/410 negative paths so the Mac client can rely on the
 * status codes for state-machine transitions.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { resetIdentityDbForTests, getIdentityDb } from '$lib/server/db';
import {
  issueToken,
  resetAntchatAuthTokensForTests
} from '$lib/server/antchatAuthStore';
import { POST as createPost } from './create/+server';
import { POST as redeemPost } from './redeem/+server';
import { GET as listGet } from './list/+server';
import { DELETE as revokeDelete } from './[token]/+server';

const TEST_EMAIL = 'test@example.com';
const PREV_USERS_PATH = process.env.ANTCHAT_DEV_USERS_PATH;
const PREV_LICENCES_PATH = process.env.ANTCHAT_DEV_LICENCES_PATH;

let tmpDir: string;
let bearerToken: string;

function writeAuthFiles(): void {
  const usersPath = join(tmpDir, 'dev-users.json');
  const licencesPath = join(tmpDir, 'dev-licences.json');
  writeFileSync(usersPath, JSON.stringify({
    users: [
      {
        email: TEST_EMAIL,
        role: 'dev',
        password_hash: bcrypt.hashSync('correct-password', 4),
        must_change_password: false
      }
    ]
  }), 'utf8');
  writeFileSync(licencesPath, JSON.stringify({
    allowedEmails: [TEST_EMAIL],
    tier: 'dev',
    features: ['all']
  }), 'utf8');
  process.env.ANTCHAT_DEV_USERS_PATH = usersPath;
  process.env.ANTCHAT_DEV_LICENCES_PATH = licencesPath;
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetAntchatAuthTokensForTests();
  tmpDir = mkdtempSync(join(tmpdir(), 'remote-invites-'));
  writeAuthFiles();
  bearerToken = issueToken(TEST_EMAIL).token;
});

afterEach(() => {
  resetIdentityDbForTests();
  resetAntchatAuthTokensForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV_USERS_PATH === undefined) delete process.env.ANTCHAT_DEV_USERS_PATH;
  else process.env.ANTCHAT_DEV_USERS_PATH = PREV_USERS_PATH;
  if (PREV_LICENCES_PATH === undefined) delete process.env.ANTCHAT_DEV_LICENCES_PATH;
  else process.env.ANTCHAT_DEV_LICENCES_PATH = PREV_LICENCES_PATH;
});

function postReq<T>(url: string, body: unknown, token?: string): T {
  return {
    request: new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    })
  } as unknown as T;
}

function postReqWithParams<T>(
  url: string,
  body: unknown,
  params: Record<string, string>,
  token?: string
): T {
  return {
    request: new Request(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {})
      },
      body: JSON.stringify(body)
    }),
    params
  } as unknown as T;
}

function getReq<T>(url: string, token?: string): T {
  const u = new URL(url);
  return {
    request: new Request(url, {
      method: 'GET',
      headers: token ? { authorization: `Bearer ${token}` } : {}
    }),
    url: u
  } as unknown as T;
}

function deleteReq<T>(url: string, params: Record<string, string>, token?: string): T {
  return {
    request: new Request(url, {
      method: 'DELETE',
      headers: token ? { authorization: `Bearer ${token}` } : {}
    }),
    params
  } as unknown as T;
}

describe('POST /api/remote-invites/create', () => {
  it('gate 1 — Bearer-auth user creates an invite (201 + invite_url + token)', async () => {
    const res = await createPost(postReq('http://x/api/remote-invites/create', {
      roomId: 'r1',
      lifetimePreset: '48h'
    }, bearerToken));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token).toMatch(/^ANT-/);
    expect(body.admission_id.startsWith('adm_')).toBe(true);
    expect(body.room_id).toBe('r1');
    expect(body.lifetime_preset).toBe('48h');
    expect(body.invite_url).toContain('antchat://invite?');
    expect(body.invite_url).toContain(`admission_id=${body.admission_id}`);
    expect(body.invite_url).toContain(`token=${body.token}`);
  });

  it('defaults to 48h when lifetimePreset omitted', async () => {
    const res = await createPost(postReq('http://x/api/remote-invites/create', {
      roomId: 'r1'
    }, bearerToken));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.lifetime_preset).toBe('48h');
  });

  it('401 missing Bearer', async () => {
    await expect(
      createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r1' }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it('401 invalid Bearer', async () => {
    await expect(
      createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r1' }, 'bogus'))
    ).rejects.toMatchObject({ status: 401 });
  });

  it('400 missing roomId', async () => {
    await expect(
      createPost(postReq('http://x/api/remote-invites/create', { lifetimePreset: '48h' }, bearerToken))
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400 bad lifetime_preset enum', async () => {
    await expect(
      createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r1', lifetimePreset: 'foo' }, bearerToken))
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400 malformed JSON body', async () => {
    const req = {
      request: new Request('http://x/api/remote-invites/create', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${bearerToken}`
        },
        body: 'not json'
      })
    } as unknown as Parameters<typeof createPost>[0];
    await expect(createPost(req)).rejects.toMatchObject({ status: 400 });
  });
});

describe('POST /api/remote-invites/redeem', () => {
  async function mintInvite(): Promise<{ admission_id: string; token: string; invite_url: string }> {
    const res = await createPost(postReq('http://x/api/remote-invites/create', {
      roomId: 'r1',
      lifetimePreset: '48h'
    }, bearerToken));
    return res.json();
  }

  it('gate 2 — antchat://invite?... redeems to mapping + bridge_token (200)', async () => {
    const inv = await mintInvite();
    const res = await redeemPost(postReq('http://x/api/remote-invites/redeem', {
      invite_url: inv.invite_url
    }, bearerToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.bridge_token).toMatch(/^rbt_/);
    expect(body.mapping.id).toMatch(/^map_/);
    expect(body.mapping.room_id).toBe('r1');
    expect(body.mapping.direction).toBe('both');
    expect(body.room_id).toBe('r1');
  });

  it('gate 3 — redeem mints a membership row in the room', async () => {
    const inv = await mintInvite();
    await redeemPost(postReq('http://x/api/remote-invites/redeem', {
      invite_url: inv.invite_url
    }, bearerToken));
    const db = getIdentityDb();
    const rows = db.prepare(`SELECT * FROM room_memberships WHERE room_id = ?`).all('r1') as Array<{ handle: string }>;
    expect(rows.length).toBeGreaterThanOrEqual(1);
    // The synthetic mapping creates a membership keyed by @<label>; the
    // label defaults to the redeemer's antchat handle local-part.
    expect(rows.some((r) => r.handle === '@test')).toBe(true);
  });

  it('accepts split body shape { admission_id, token }', async () => {
    const inv = await mintInvite();
    const res = await redeemPost(postReq('http://x/api/remote-invites/redeem', {
      admission_id: inv.admission_id,
      token: inv.token
    }, bearerToken));
    expect(res.status).toBe(200);
  });

  it('honours direction override', async () => {
    const inv = await mintInvite();
    const res = await redeemPost(postReq('http://x/api/remote-invites/redeem', {
      invite_url: inv.invite_url,
      direction: 'in'
    }, bearerToken));
    const body = await res.json();
    expect(body.mapping.direction).toBe('in');
  });

  it('honours explicit label', async () => {
    const inv = await mintInvite();
    const res = await redeemPost(postReq('http://x/api/remote-invites/redeem', {
      invite_url: inv.invite_url,
      label: 'Daisy-laptop'
    }, bearerToken));
    const body = await res.json();
    expect(body.mapping.remote_instance_label).toBe('Daisy-laptop');
  });

  it('410 second redeem of same admission', async () => {
    const inv = await mintInvite();
    await redeemPost(postReq('http://x/api/remote-invites/redeem', {
      invite_url: inv.invite_url
    }, bearerToken));
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', { invite_url: inv.invite_url }, bearerToken))
    ).rejects.toMatchObject({ status: 410 });
  });

  it('410 wrong token', async () => {
    const inv = await mintInvite();
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', {
        admission_id: inv.admission_id,
        token: 'ANT-WRONG-CODE'
      }, bearerToken))
    ).rejects.toMatchObject({ status: 410 });
  });

  it('410 unknown admission_id', async () => {
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', {
        admission_id: 'adm_unknown',
        token: 'ANT-AAA-BBBB'
      }, bearerToken))
    ).rejects.toMatchObject({ status: 410 });
  });

  it('401 missing Bearer', async () => {
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', {
        admission_id: 'adm_x',
        token: 'ANT-AAA-BBBB'
      }))
    ).rejects.toMatchObject({ status: 401 });
  });

  it('400 malformed invite_url', async () => {
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', {
        invite_url: 'not-a-url'
      }, bearerToken))
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400 invite_url missing required query params', async () => {
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', {
        invite_url: 'antchat://invite?foo=bar'
      }, bearerToken))
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400 bad direction enum', async () => {
    const inv = await mintInvite();
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', {
        invite_url: inv.invite_url,
        direction: 'sideways'
      }, bearerToken))
    ).rejects.toMatchObject({ status: 400 });
  });
});

describe('GET /api/remote-invites/list', () => {
  it('lists pending invites for a room', async () => {
    await createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r1', lifetimePreset: '48h' }, bearerToken));
    await createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r1', lifetimePreset: 'today' }, bearerToken));
    await createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r2', lifetimePreset: '48h' }, bearerToken));

    const res = await listGet(getReq('http://x/api/remote-invites/list?roomId=r1', bearerToken));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.invites).toHaveLength(2);
    expect(body.invites.every((i: { room_id: string }) => i.room_id === 'r1')).toBe(true);
  });

  it('excludes already-redeemed invites (graduate to mappings, not still pending)', async () => {
    const created = await createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r1', lifetimePreset: '48h' }, bearerToken));
    const inv = await created.json();
    await redeemPost(postReq('http://x/api/remote-invites/redeem', { invite_url: inv.invite_url }, bearerToken));

    const res = await listGet(getReq('http://x/api/remote-invites/list?roomId=r1', bearerToken));
    const body = await res.json();
    expect(body.invites).toHaveLength(0);
  });

  it('never replays the plaintext invite code', async () => {
    await createPost(postReq('http://x/api/remote-invites/create', { roomId: 'r1', lifetimePreset: '48h' }, bearerToken));
    const res = await listGet(getReq('http://x/api/remote-invites/list?roomId=r1', bearerToken));
    const body = await res.json();
    for (const inv of body.invites) {
      expect(inv.token).toBeUndefined();
      expect(inv.code).toBeUndefined();
    }
  });

  it('400 missing roomId', async () => {
    await expect(
      listGet(getReq('http://x/api/remote-invites/list', bearerToken))
    ).rejects.toMatchObject({ status: 400 });
  });

  it('401 missing Bearer', async () => {
    await expect(
      listGet(getReq('http://x/api/remote-invites/list?roomId=r1'))
    ).rejects.toMatchObject({ status: 401 });
  });
});

describe('DELETE /api/remote-invites/:token', () => {
  async function mintInvite(): Promise<{ admission_id: string; token: string; invite_url: string }> {
    const res = await createPost(postReq('http://x/api/remote-invites/create', {
      roomId: 'r1',
      lifetimePreset: '48h'
    }, bearerToken));
    return res.json();
  }

  it('200 revokes a pending admission', async () => {
    const inv = await mintInvite();
    const res = await revokeDelete(deleteReq(
      `http://x/api/remote-invites/${inv.admission_id}`,
      { token: inv.admission_id },
      bearerToken
    ));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ revoked: true, admission_id: inv.admission_id });
  });

  it('gate 4 — revoked invite cannot be redeemed (410)', async () => {
    const inv = await mintInvite();
    await revokeDelete(deleteReq(
      `http://x/api/remote-invites/${inv.admission_id}`,
      { token: inv.admission_id },
      bearerToken
    ));
    await expect(
      redeemPost(postReq('http://x/api/remote-invites/redeem', { invite_url: inv.invite_url }, bearerToken))
    ).rejects.toMatchObject({ status: 410 });
  });

  it('404 revoking an already-revoked admission', async () => {
    const inv = await mintInvite();
    await revokeDelete(deleteReq(
      `http://x/api/remote-invites/${inv.admission_id}`,
      { token: inv.admission_id },
      bearerToken
    ));
    await expect(revokeDelete(deleteReq(
      `http://x/api/remote-invites/${inv.admission_id}`,
      { token: inv.admission_id },
      bearerToken
    ))).rejects.toMatchObject({ status: 404 });
  });

  it('404 unknown admission id', async () => {
    await expect(revokeDelete(deleteReq(
      'http://x/api/remote-invites/adm_unknown',
      { token: 'adm_unknown' },
      bearerToken
    ))).rejects.toMatchObject({ status: 404 });
  });

  it('401 missing Bearer', async () => {
    await expect(revokeDelete(deleteReq(
      'http://x/api/remote-invites/adm_x',
      { token: 'adm_x' }
    ))).rejects.toMatchObject({ status: 401 });
  });
});
