import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { registerDeck } from '../src/lib/server/decks.js';
import { registerSheet } from '../src/lib/server/sheets.js';
import { registerSiteTunnel } from '../src/lib/server/tunnels.js';
import { GET as getRoomArtefacts } from '../src/routes/api/sessions/[id]/artefacts/+server.js';
import { GET as getDoc, PATCH as patchDoc } from '../src/routes/api/docs/[docId]/+server.js';

const ROOM_ID = 'room-artefacts-test';
const OTHER_ROOM_ID = 'room-artefacts-other';
const EMPTY_ROOM_ID = 'room-artefacts-empty';
const TERMINAL_ID = 'room-artefacts-terminal';

let dataDir = '';
let openSlideDir = '';
let originalDataDir: string | undefined;
let originalOpenSlideDir: string | undefined;

function event(sessionId: string, roomScopeId: string | null = ROOM_ID) {
  return {
    params: { id: sessionId },
    url: new URL(`https://ant.test/api/sessions/${sessionId}/artefacts`),
    locals: roomScopeId ? { roomScope: { roomId: roomScopeId, kind: 'web' } } : {},
  } as any;
}

function docEvent(docId: string, roomScopeId: string | null = ROOM_ID) {
  return {
    params: { docId },
    url: new URL(`https://ant.test/api/docs/${docId}`),
    locals: roomScopeId ? { roomScope: { roomId: roomScopeId, kind: 'web' } } : {},
  } as any;
}

function docPatchEvent(docId: string, roomScopeId: string | null = ROOM_ID) {
  return {
    params: { docId },
    url: new URL(`https://ant.test/api/docs/${docId}`),
    request: new Request(`https://ant.test/api/docs/${docId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        sectionId: 'transcript',
        heading: 'Transcript',
        content: 'Room-scoped transcript',
        author: '@test',
      }),
    }),
    locals: roomScopeId ? { roomScope: { roomId: roomScopeId, kind: 'cli' } } : {},
  } as any;
}

async function read(sessionId = ROOM_ID, roomScopeId: string | null = ROOM_ID) {
  return getRoomArtefacts(event(sessionId, roomScopeId));
}

async function expectDocForbidden(docId: string, roomScopeId: string) {
  try {
    await getDoc(docEvent(docId, roomScopeId));
  } catch (err) {
    expect(err).toMatchObject({ status: 403 });
    return;
  }
  throw new Error(`Expected ${docId} to be forbidden for ${roomScopeId}`);
}

function tableCounts() {
  const db = getDb();
  const count = (table: string) =>
    (db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as { count: number }).count;
  return {
    messages: count('messages'),
    tasks: count('tasks'),
    file_refs: count('file_refs'),
    room_links: count('room_links'),
  };
}

function seedRooms() {
  queries.createSession(ROOM_ID, 'Artefact Test Room', 'chat', '15m', null, openSlideDir, '{}');
  queries.createSession(OTHER_ROOM_ID, 'Other Artefact Room', 'chat', '15m', null, openSlideDir, '{}');
  queries.createSession(EMPTY_ROOM_ID, 'Empty Artefact Room', 'chat', '15m', null, openSlideDir, '{}');
  queries.createSession(TERMINAL_ID, 'Linked Terminal', 'terminal', '15m', null, openSlideDir, '{}');
  queries.setLinkedChat(TERMINAL_ID, ROOM_ID);

  queries.appendRunEvent(
    ROOM_ID,
    1_771_234_500_000,
    'json',
    'high',
    'plan_section',
    'Room artefacts sidebar',
    JSON.stringify({
      plan_id: 'room-artefacts-sidebar-2026-05-08',
      title: 'Room artefacts sidebar',
      order: 0,
      acceptance_id: 'section-room-artefacts',
      status: 'active',
    }),
  );
  queries.appendRunEvent(
    OTHER_ROOM_ID,
    1_771_234_500_001,
    'json',
    'high',
    'plan_section',
    'Other plan',
    JSON.stringify({
      plan_id: 'other-room-plan',
      title: 'Other room plan',
      order: 0,
      acceptance_id: 'section-other',
      status: 'active',
    }),
  );

  registerDeck({
    slug: 'artefact-demo-deck',
    owner_session_id: ROOM_ID,
    allowed_room_ids: [ROOM_ID],
    deck_dir: join(openSlideDir, 'artefact-demo-deck'),
    dev_port: 5180,
  });
  registerDeck({
    slug: 'other-demo-deck',
    owner_session_id: OTHER_ROOM_ID,
    allowed_room_ids: [OTHER_ROOM_ID],
    deck_dir: join(openSlideDir, 'other-demo-deck'),
  });

  registerSheet({
    slug: 'artefact-demo-sheet',
    owner_session_id: ROOM_ID,
    allowed_room_ids: [ROOM_ID],
    sheet_dir: join(openSlideDir, 'artefact-demo-sheet'),
  });
  registerSheet({
    slug: 'other-demo-sheet',
    owner_session_id: OTHER_ROOM_ID,
    allowed_room_ids: [OTHER_ROOM_ID],
    sheet_dir: join(openSlideDir, 'other-demo-sheet'),
  });

  registerSiteTunnel({
    slug: 'artefact-demo-site',
    title: 'Artefact Demo Site',
    public_url: 'https://artefact-demo.trycloudflare.com',
    local_url: 'http://localhost:3000',
    owner_session_id: ROOM_ID,
    allowed_room_ids: [ROOM_ID],
    status: 'live',
  });
  registerSiteTunnel({
    slug: 'other-demo-site',
    title: 'Other Demo Site',
    public_url: 'https://other-demo.trycloudflare.com',
    local_url: 'http://localhost:3001',
    owner_session_id: OTHER_ROOM_ID,
    allowed_room_ids: [OTHER_ROOM_ID],
    status: 'live',
  });

  queries.upsertMemoryByKey(
    'docs/artefact-demo-doc',
    JSON.stringify({
      title: 'Artefact Demo Doc',
      description: 'Room-scoped research doc',
      status: 'ready',
    }),
    'doc',
    ROOM_ID,
    'test',
  );
  queries.upsertMemoryByKey(
    'docs/other-demo-doc',
    JSON.stringify({ title: 'Other Demo Doc', status: 'draft' }),
    'doc',
    OTHER_ROOM_ID,
    'test',
  );
  queries.upsertMemoryByKey(
    'docs/global-demo-doc',
    JSON.stringify({ title: 'Global Demo Doc', status: 'draft' }),
    'doc',
    null,
    'test',
  );
}

describe('room artefacts API', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    originalOpenSlideDir = process.env.ANT_OPEN_SLIDE_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-room-artefacts-db-'));
    openSlideDir = mkdtempSync(join(tmpdir(), 'ant-room-artefacts-open-slide-'));
    process.env.ANT_DATA_DIR = dataDir;
    process.env.ANT_OPEN_SLIDE_DIR = openSlideDir;
    _resetForTest();
    getDb();
    seedRooms();
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    if (originalOpenSlideDir === undefined) delete process.env.ANT_OPEN_SLIDE_DIR;
    else process.env.ANT_OPEN_SLIDE_DIR = originalOpenSlideDir;
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(openSlideDir, { recursive: true, force: true });
  });

  it('returns linked plans, decks, docs, and sheets for the room only', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    const body = await response.json();

    expect(body.room_id).toBe(ROOM_ID);
    expect(body.counts).toMatchObject({ total: 5, plans: 1, decks: 1, docs: 1, sheets: 1, sites: 1 });
    expect(body.artefacts.plans.map((item: any) => item.id)).toEqual(['room-artefacts-sidebar-2026-05-08']);
    expect(body.artefacts.decks.map((item: any) => item.id)).toEqual(['artefact-demo-deck']);
    expect(body.artefacts.docs.map((item: any) => item.id)).toEqual(['artefact-demo-doc']);
    expect(body.artefacts.sheets.map((item: any) => item.id)).toEqual(['artefact-demo-sheet']);
    expect(body.artefacts.sites.map((item: any) => item.id)).toEqual(['artefact-demo-site']);
    expect(body.artefacts.sites[0]).toMatchObject({
      href: 'https://artefact-demo.trycloudflare.com/',
      status: 'live',
      meta: { local_url: 'http://localhost:3000/' },
    });
    expect(JSON.stringify(body)).not.toContain('other-demo');
    expect(JSON.stringify(body)).not.toContain('global-demo');
    for (const group of Object.values(body.artefacts) as any[][]) {
      for (const item of group) expect(item.room_id).toBe(ROOM_ID);
    }
    expect(body.artefacts.docs[0].href).toContain(`session_id=${ROOM_ID}`);
  });

  it('uses the linked chat room when the sidebar is mounted on a terminal', async () => {
    const response = await read(TERMINAL_ID, ROOM_ID);
    const body = await response.json();
    expect(body.session_id).toBe(TERMINAL_ID);
    expect(body.source_session_id).toBe(TERMINAL_ID);
    expect(body.room_id).toBe(ROOM_ID);
    expect(body.counts.total).toBe(5);
  });

  it('does not create task, file, message, or room-link rows while reading', async () => {
    const before = tableCounts();
    const response = await read();
    expect(response.status).toBe(200);
    await response.json();
    expect(tableCounts()).toEqual(before);
  });

  it('returns empty groups for rooms with no linked artefacts', async () => {
    const response = await read(EMPTY_ROOM_ID, EMPTY_ROOM_ID);
    const body = await response.json();
    expect(body.counts.total).toBe(0);
    expect(body.artefacts).toEqual({ plans: [], decks: [], docs: [], sheets: [], sites: [] });
  });

  it('honours room-scoped read boundaries', async () => {
    await expect(read(ROOM_ID, OTHER_ROOM_ID)).rejects.toMatchObject({ status: 403 });
  });

  it('keeps linked docs readable only by their owning room token', async () => {
    const own = await getDoc(docEvent('artefact-demo-doc', ROOM_ID));
    expect(own.status).toBe(200);
    expect((await own.json()).id).toBe('artefact-demo-doc');

    await expectDocForbidden('artefact-demo-doc', OTHER_ROOM_ID);
    await expectDocForbidden('other-demo-doc', ROOM_ID);
    await expectDocForbidden('global-demo-doc', ROOM_ID);
  });

  it('keeps linked doc writes scoped to the owning room token', async () => {
    const own = await patchDoc(docPatchEvent('artefact-demo-doc', ROOM_ID));
    expect(own.status).toBe(200);

    await expect(patchDoc(docPatchEvent('artefact-demo-doc', OTHER_ROOM_ID))).rejects.toMatchObject({ status: 403 });
    await expect(patchDoc(docPatchEvent('global-demo-doc', ROOM_ID))).rejects.toMatchObject({ status: 403 });
  });
});
