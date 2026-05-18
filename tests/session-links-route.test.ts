import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { SESSIONS_CHANNEL } from '../src/lib/ws-channels.js';

const broadcast = vi.fn();

vi.mock('$lib/server/ws-broadcast.js', () => ({
  broadcast,
}));

const route = await import('../src/routes/api/sessions/[id]/links/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function getEvent(id: string, locals = {}) {
  return { params: { id }, locals } as any;
}

function requestEvent(id: string, body: unknown, locals = {}) {
  return {
    params: { id },
    locals,
    request: new Request(`https://ant.test/api/sessions/${id}/links`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

function deleteEvent(id: string, linkId: string | null, locals = {}) {
  const url = new URL(`https://ant.test/api/sessions/${id}/links`);
  if (linkId !== null) url.searchParams.set('linkId', linkId);
  return { params: { id }, url, locals } as any;
}

async function expectHttpError(action: () => unknown | Promise<unknown>, status: number) {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({ status });
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

describe('/api/sessions/:id/links', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-links-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    broadcast.mockReset();

    queries.createSession('room-a', 'Room A', 'chat', 'forever', 'workspace-a', '/tmp/a', '{}');
    queries.createSession('room-b', 'Room B', 'chat', 'forever', null, null, '{}');
    queries.createSession('room-c', 'Room C', 'chat', 'forever', null, null, '{}');
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-room', 'Archived Room', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-room', 'Deleted Room', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-room');
    queries.softDeleteSession('deleted-room');
    queries.addRoomMember('room-a', 'terminal-a', 'participant', 'codex', '@codex');
    queries.createRoomLink('link-existing', 'room-a', 'room-b', 'discussion_of', 'Existing Link', '@you', '{}');
    queries.createRoomLink('link-other', 'room-b', 'room-c', 'discussion_of', 'Other Link', '@you', '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('lists outgoing and incoming links for active chat rooms only', async () => {
    const response = await route.GET(getEvent('room-b'));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      outgoing: [
        expect.objectContaining({ id: 'link-other', source_room_id: 'room-b', target_room_id: 'room-c' }),
      ],
      incoming: [
        expect.objectContaining({ id: 'link-existing', source_room_id: 'room-a', target_room_id: 'room-b' }),
      ],
    });

    await expectHttpError(() => route.GET({ params: { id: 'missing' } } as any), 404);
    await expectHttpError(() => route.GET({ params: { id: 'terminal-a' } } as any), 400);
    await expectHttpError(() => route.GET({ params: { id: 'archived-room' } } as any), 410);
  });

  it('rejects cross-room scoped reads before listing links', async () => {
    await expectHttpError(
      () =>
        route.GET(
          getEvent('room-a', {
            roomScope: { roomId: 'room-b', kind: 'cli' },
          }),
        ),
      403,
    );
  });

  it('creates a source-scoped link to an active chat room and broadcasts it', async () => {
    const response = await route.POST(requestEvent('room-a', {
      targetRoomId: 'room-c',
      relationship: 'follows_up',
      title: 'Follow-up',
      createdBy: '@you',
      settings: { priority: 'p1' },
    }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      id: expect.any(String),
      sourceRoomId: 'room-a',
      targetRoomId: 'room-c',
      relationship: 'follows_up',
    });
    expect(queries.getRoomLinks('room-a')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: body.id, target_room_id: 'room-c', title: 'Follow-up' }),
    ]));
    expect(broadcast).toHaveBeenCalledWith('room-a', {
      type: 'room_link_created',
      roomId: 'room-a',
      linkId: body.id,
      targetRoomId: 'room-c',
      relationship: 'follows_up',
    });
  });

  it('creates discussion rooms with copied members and sessions-changed broadcast', async () => {
    const response = await route.POST(requestEvent('room-a', {
      title: 'Discussion: Room A polish',
      relationship: 'discussion_of',
      settings: { focus: 'ui' },
    }));
    const body = await response.json();

    expect(response.status).toBe(201);
    expect(body).toMatchObject({
      id: expect.any(String),
      sourceRoomId: 'room-a',
      targetRoomId: expect.any(String),
      discussionName: 'Discussion: Room A polish',
      relationship: 'discussion_of',
      membersCopied: true,
    });
    expect(queries.getSession(body.targetRoomId)).toMatchObject({
      id: body.targetRoomId,
      name: 'Discussion: Room A polish',
      type: 'chat',
      workspace_id: 'workspace-a',
      root_dir: '/tmp/a',
    });
    expect(queries.getRoomMember(body.targetRoomId, 'terminal-a')).toMatchObject({
      role: 'participant',
      cli_flag: 'codex',
      alias: '@codex',
    });
    expect(broadcast).toHaveBeenCalledWith('room-a', expect.objectContaining({
      type: 'room_link_created',
      targetRoomId: body.targetRoomId,
      title: 'Discussion: Room A polish',
    }));
    expect(broadcast).toHaveBeenCalledWith(SESSIONS_CHANNEL, { type: 'sessions_changed' });
  });

  it('rejects malformed JSON and invalid source or target rooms', async () => {
    const malformed = await route.POST(requestEvent('room-a', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ error: 'Invalid JSON' });

    await expectHttpError(() => route.POST(requestEvent('missing', {})), 404);
    await expectHttpError(() => route.POST(requestEvent('terminal-a', {})), 400);
    await expectHttpError(() => route.POST(requestEvent('deleted-room', {})), 410);
    await expectHttpError(() => route.POST(requestEvent('archived-room', '{')), 410);
    await expectHttpError(() => route.POST(requestEvent('room-a', { targetRoomId: 'terminal-a' })), 400);
    await expectHttpError(() => route.POST(requestEvent('room-a', { targetRoomId: 'archived-room' })), 410);
    await expectHttpError(() => route.POST(requestEvent('room-a', { targetRoomId: 'room-a' })), 400);
    await expectHttpError(() => route.POST(requestEvent('room-a', { targetRoomId: 'room-c', relationship: 'invalid' })), 400);
  });

  it('rejects cross-room and read-only scoped tokens before creating links', async () => {
    const payload = { targetRoomId: 'room-c' };

    await expectHttpError(
      () =>
        route.POST(
          requestEvent('room-a', payload, {
            roomScope: { roomId: 'room-b', kind: 'cli' },
          }),
        ),
      403,
    );
    await expectHttpError(
      () =>
        route.POST(
          requestEvent('room-a', payload, {
            roomScope: { roomId: 'room-a', kind: 'web' },
          }),
        ),
      403,
    );

    expect(queries.getRoomLinks('room-a')).toEqual([
      expect.objectContaining({ id: 'link-existing' }),
    ]);
    expect(broadcast).not.toHaveBeenCalled();
  });

  it('deletes only links owned by the requested source room and broadcasts successful deletes', async () => {
    await expectHttpError(() => route.DELETE(deleteEvent('room-a', null)), 400);
    await expectHttpError(() => route.DELETE(deleteEvent('room-c', 'link-existing')), 404);
    expect(queries.getRoomLinks('room-a')).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'link-existing' }),
    ]));

    const response = await route.DELETE(deleteEvent('room-a', 'link-existing'));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(queries.getRoomLinks('room-a')).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'link-existing' }),
    ]));
    expect(broadcast).toHaveBeenLastCalledWith('room-a', {
      type: 'room_link_deleted',
      roomId: 'room-a',
      linkId: 'link-existing',
    });
  });

  it('rejects cross-room and read-only scoped tokens before deleting links', async () => {
    await expectHttpError(
      () =>
        route.DELETE(
          deleteEvent('room-a', 'link-existing', {
            roomScope: { roomId: 'room-b', kind: 'cli' },
          }),
        ),
      403,
    );
    await expectHttpError(
      () =>
        route.DELETE(
          deleteEvent('room-a', 'link-existing', {
            roomScope: { roomId: 'room-a', kind: 'web' },
          }),
        ),
      403,
    );

    expect(queries.getRoomLinks('room-a')).toEqual([
      expect.objectContaining({ id: 'link-existing' }),
    ]);
    expect(broadcast).not.toHaveBeenCalled();
  });
});
