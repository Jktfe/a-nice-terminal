import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { load } from './+page.server';
import { createArtefactInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { createBrowserSession } from '$lib/server/browserSessionStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetIdentityDbForTests } from '$lib/server/db';
import { addMembership } from '$lib/server/roomMembershipsStore';
import { upsertTerminal } from '$lib/server/terminalsStore';

const ADMIN_TOKEN_FOR_TESTS = 'artefacts-index-test-admin-token';
const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ORIGINAL_DB_PATH = process.env.ANT_FRESH_DB_PATH;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN_FOR_TESTS;
});

afterAll(() => {
  if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  if (ORIGINAL_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatRoomArtefactStoreForTests();
});

function eventFor(headers: Record<string, string> = {}) {
  const request = new Request('http://localhost/artefacts', { headers });
  return {
    request,
    url: new URL(request.url),
    params: {}
  } as unknown as Parameters<typeof load>[0];
}

function browserCookieFor(roomId: string, handle: string): string {
  const terminal = upsertTerminal({ pid: 83_001, pid_start: `artefacts-index-${handle}`, name: `artefacts-index-${handle}` });
  addMembership({ room_id: roomId, handle, terminal_id: terminal.id });
  const session = createBrowserSession({ roomId, authorHandle: handle });
  if (!session) throw new Error('createBrowserSession returned null');
  return `ant_browser_session=${session.browserSessionSecret}`;
}

describe('/artefacts index load', () => {
  it('lists artefacts from rooms the browser viewer can read', async () => {
    const roomA = createChatRoom({ name: 'Readable room', whoCreatedIt: '@reader-a' });
    const roomB = createChatRoom({ name: 'Private room', whoCreatedIt: '@reader-b' });
    createArtefactInRoom({
      id: 'art_readable',
      roomId: roomA.id,
      kind: 'doc',
      title: 'Readable artefact',
      createdBy: '@reader-a',
      nowMs: 2
    });
    createArtefactInRoom({
      id: 'art_private',
      roomId: roomB.id,
      kind: 'doc',
      title: 'Private artefact',
      createdBy: '@reader-b',
      nowMs: 3
    });

    const data = await load(eventFor({ cookie: browserCookieFor(roomA.id, '@reader-a') })) as {
      artefacts: { id: string; roomId: string; roomName: string; title: string }[];
    };

    expect(data.artefacts).toEqual([
      expect.objectContaining({
        id: 'art_readable',
        roomId: roomA.id,
        roomName: 'Readable room',
        title: 'Readable artefact'
      })
    ]);
  });

  it('lets admin-bearer list artefacts across readable rooms', async () => {
    const roomA = createChatRoom({ name: 'Room A', whoCreatedIt: '@reader-a' });
    const roomB = createChatRoom({ name: 'Room B', whoCreatedIt: '@reader-b' });
    createArtefactInRoom({ id: 'art_a', roomId: roomA.id, kind: 'doc', title: 'A', nowMs: 1 });
    createArtefactInRoom({ id: 'art_b', roomId: roomB.id, kind: 'deck', title: 'B', nowMs: 2 });

    const data = await load(eventFor({ authorization: `Bearer ${ADMIN_TOKEN_FOR_TESTS}` })) as {
      artefacts: { id: string }[];
    };

    expect(data.artefacts.map((artefact) => artefact.id)).toEqual(['art_b', 'art_a']);
  });
});
