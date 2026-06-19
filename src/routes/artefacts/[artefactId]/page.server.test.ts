import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { load } from './+page.server';
import {
  createArtefactInRoom,
  resetChatRoomArtefactStoreForTests
} from '$lib/server/chatRoomArtefactStore';
import type { RoomArtefact } from '$lib/server/chatRoomArtefactStore';
import {
  resetChatRoomArtefactContentStoreForTests,
  upsertArtefactContent
} from '$lib/server/chatRoomArtefactContentStore';
import type { ArtefactContent } from '$lib/server/chatRoomArtefactContentStore';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';

const ORIGINAL_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'artefact-page-test-admin-token';

type ArtefactPageData = {
  artefact: RoomArtefact;
  content: ArtefactContent | null;
};

async function loadArtefact(
  artefactId: string,
  token: string | null = ADMIN_TOKEN
): Promise<ArtefactPageData> {
  const url = new URL(`http://localhost/artefacts/${artefactId}`);
  const headers = new Headers();
  if (token !== null) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return await load({
    params: { artefactId },
    request: new Request(url, { headers }),
    url
  } as Parameters<typeof load>[0]) as ArtefactPageData;
}

async function caughtLoad(
  artefactId: string,
  token: string | null = ADMIN_TOKEN
): Promise<{ status?: number; message?: string }> {
  try {
    await loadArtefact(artefactId, token);
    return {};
  } catch (thrownByLoad) {
    const failure = thrownByLoad as { status?: number; body?: { message?: string }; message?: string };
    return {
      status: failure.status,
      message: failure.body?.message ?? failure.message
    };
  }
}

describe('/artefacts/[artefactId] page server', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    resetChatRoomArtefactContentStoreForTests();
    resetChatRoomArtefactStoreForTests();
    resetChatRoomStoreForTests();
  });

  afterAll(() => {
    if (ORIGINAL_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN_TOKEN;
  });

  it('requires room read access before returning an existing artefact', async () => {
    const room = createChatRoom({ name: 'private artefacts', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      roomId: room.id,
      kind: 'doc',
      title: 'Private note',
      refUrl: `/artefacts/private-note`
    });

    const failure = await caughtLoad(artefact.id, null);

    expect(failure.status).toBe(401);
    expect(failure.message).toContain('Authentication required');
  });

  it('returns artefact metadata and stored content for an authorised reader', async () => {
    const room = createChatRoom({ name: 'readable artefacts', whoCreatedIt: '@you' });
    const artefact = createArtefactInRoom({
      id: 'art_readable',
      roomId: room.id,
      kind: 'doc',
      title: 'Runbook',
      refUrl: `/artefacts/art_readable`
    });
    upsertArtefactContent({
      id: 'content_readable',
      artefactId: artefact.id,
      roomId: room.id,
      kind: 'doc',
      contentFormat: 'markdown',
      contentBody: '# Runbook',
      updatedByHandle: '@you',
      nowMs: 123
    });

    const result = await loadArtefact(artefact.id);

    expect(result.artefact).toMatchObject({
      id: artefact.id,
      roomId: room.id,
      title: 'Runbook'
    });
    expect(result.content).toMatchObject({
      artefactId: artefact.id,
      contentBody: '# Runbook'
    });
  });

  it('returns 404 for an unknown artefact', async () => {
    const failure = await caughtLoad('missing');

    expect(failure.status).toBe(404);
    expect(failure.message).toContain('Artefact not found');
  });
});
