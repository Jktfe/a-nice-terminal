import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET } from './+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { setRoomPolicy } from '$lib/server/roomPolicyStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-room-policy-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

async function callGet(roomId: string): Promise<Response> {
  const url = new URL(`http://localhost/api/chat-rooms/${roomId}/policy`);
  const event = { request: new Request(url), params: { roomId }, url } as unknown as Parameters<typeof GET>[0];
  try {
    return (await GET(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const f = thrown as { status?: number; body?: { message?: string } };
    if (typeof f?.status === 'number') return new Response(JSON.stringify(f.body ?? {}), { status: f.status });
    throw thrown;
  }
}

describe('GET /api/chat-rooms/:roomId/policy', () => {
  it('404s for a room that does not exist', async () => {
    const response = await callGet('does-not-exist');
    expect(response.status).toBe(404);
  });

  it('returns the default two-axis policy when none is set (invite-join, allowed-read)', async () => {
    const room = createChatRoom({ name: 'policy-default', whoCreatedIt: '@you' });
    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ joinPolicy: 'invite', readPolicy: 'allowed' });
  });

  it('reflects an explicitly set policy via getRoomPolicy (consumes A store, no reimpl)', async () => {
    const room = createChatRoom({ name: 'policy-open', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'open', readPolicy: 'open' });

    const response = await callGet(room.id);
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toEqual({ joinPolicy: 'open', readPolicy: 'open' });
  });

  it('returns only the two policy axes (read-only projection, no extra fields)', async () => {
    const room = createChatRoom({ name: 'policy-shape', whoCreatedIt: '@you' });
    setRoomPolicy(room.id, { joinPolicy: 'closed', readPolicy: 'invite' });

    const response = await callGet(room.id);
    const payload = await response.json();
    expect(Object.keys(payload).sort()).toEqual(['joinPolicy', 'readPolicy']);
    expect(payload.joinPolicy).toBe('closed');
    expect(payload.readPolicy).toBe('invite');
  });
});
