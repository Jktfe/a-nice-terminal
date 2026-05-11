import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { GET as getParticipants } from '../src/routes/api/sessions/[id]/participants/+server.js';
import { _resetForTest, queries } from '../src/lib/server/db.js';

const ENV_KEYS = ['ANT_DATA_DIR'] as const;
const originalEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
let dataDir = '';

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

async function participants(roomId: string, query = '') {
  const response = await getParticipants({
    params: { id: roomId },
    url: new URL(`https://ant.test/api/sessions/${roomId}/participants${query}`),
  } as any);
  expect(response.status).toBe(200);
  return response.json();
}

describe('/api/sessions/[id]/participants remote invite handles', () => {
  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'ant-participants-remote-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
  });

  afterEach(() => {
    _resetForTest();
    restoreEnv();
    rmSync(dataDir, { recursive: true, force: true });
    dataDir = '';
  });

  it('includes active room-token handles in the autocomplete source without exposing token secrets', async () => {
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('local-agent', 'Local Agent', 'terminal', 'forever', null, null, '{}');
    queries.setHandle('local-agent', '@local', 'Local Agent');
    queries.addRoomMember('room-a', 'local-agent', 'participant', 'codex', '@local');

    queries.createRoomInvite({
      id: 'invite-a',
      room_id: 'room-a',
      label: 'Remote ANT invite',
      password_hash: 'test-hash',
      kinds: 'cli,mcp',
      created_by: null,
    });
    queries.createRoomInvite({
      id: 'invite-b',
      room_id: 'room-b',
      label: 'Other room invite',
      password_hash: 'test-hash',
      kinds: 'cli',
      created_by: null,
    });
    queries.createRoomInvite({
      id: 'invite-revoked',
      room_id: 'room-a',
      label: 'Revoked invite',
      password_hash: 'test-hash',
      kinds: 'cli',
      created_by: null,
    });

    queries.createRoomToken({
      id: 'token-xeno',
      invite_id: 'invite-a',
      room_id: 'room-a',
      token_hash: 'secret-token-hash',
      kind: 'cli',
      handle: 'xeno',
      meta: '{}',
    });
    queries.createRoomToken({
      id: 'token-deck-viewer',
      invite_id: 'invite-a',
      room_id: 'room-a',
      token_hash: 'deck-viewer-secret-token-hash',
      kind: 'web',
      handle: '@deck-viewer',
      meta: '{}',
    });
    queries.createRoomToken({
      id: 'token-other',
      invite_id: 'invite-b',
      room_id: 'room-b',
      token_hash: 'other-secret-token-hash',
      kind: 'cli',
      handle: '@other-room',
      meta: '{}',
    });
    queries.createRoomToken({
      id: 'token-revoked',
      invite_id: 'invite-revoked',
      room_id: 'room-a',
      token_hash: 'revoked-secret-token-hash',
      kind: 'cli',
      handle: '@revoked',
      meta: '{}',
    });
    queries.revokeRoomInvite('invite-revoked');

    const body = await participants('room-a');
    const handles = body.all.map((p: any) => p.handle);

    expect(handles).toContain('@local');
    expect(handles).toContain('@xeno');
    expect(handles).not.toContain('@deck-viewer');
    expect(handles).not.toContain('@other-room');
    expect(handles).not.toContain('@revoked');
    expect(JSON.stringify(body)).not.toContain('secret-token-hash');
    expect(JSON.stringify(body)).not.toContain('token_hash');
  });

  it('dedupes invite-token handles that are already concrete room members', async () => {
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('xeno-session', 'Xeno', 'terminal', 'forever', null, null, '{}');
    queries.setHandle('xeno-session', '@xeno', 'Xeno');
    queries.addRoomMember('room-a', 'xeno-session', 'participant', 'codex', '@xeno');
    queries.createRoomInvite({
      id: 'invite-a',
      room_id: 'room-a',
      label: 'Remote ANT invite',
      password_hash: 'test-hash',
      kinds: 'cli',
      created_by: null,
    });
    queries.createRoomToken({
      id: 'token-xeno',
      invite_id: 'invite-a',
      room_id: 'room-a',
      token_hash: 'secret-token-hash',
      kind: 'cli',
      handle: '@xeno',
      meta: '{}',
    });

    const body = await participants('room-a');
    expect(body.all.filter((p: any) => p.handle === '@xeno')).toHaveLength(1);
  });

  it('keeps message-count enrichment off the hot path unless requested', async () => {
    queries.createSession('room-a', 'Room A', 'chat', 'forever', null, null, '{}');
    queries.createSession('local-agent', 'Local Agent', 'terminal', 'forever', null, null, '{}');
    queries.setHandle('local-agent', '@local', 'Local Agent');
    queries.addRoomMember('room-a', 'local-agent', 'participant', 'codex', '@local');
    queries.createMessage('msg-1', 'room-a', 'user', 'hello', 'text', 'complete', 'local-agent', null, null, 'message', '{}');

    const defaultBody = await participants('room-a');
    expect(defaultBody.participants[0].message_count).toBe(0);

    const countedBody = await participants('room-a', '?include_counts=1');
    expect(countedBody.participants[0].message_count).toBe(1);
  });
});
