import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import { readDeckMeta, registerDeck } from '../src/lib/server/decks.js';
import { createDeckCookie } from '../src/lib/server/deck-view-auth.js';
import { createInvite, exchangePassword } from '../src/lib/server/room-invites.js';
import { GET as listFiles } from '../src/routes/api/decks/[slug]/files/+server.js';
import {
  DELETE as deleteFile,
  GET as readFile,
  PUT as writeFile,
} from '../src/routes/api/decks/[slug]/files/[...path]/+server.js';
import { GET as proxyDeck } from '../src/routes/deck/[slug]/[...path]/+server.js';
import { POST as loginDeck } from '../src/routes/deck/[slug]/login/+server.js';

const ROOM_A = 'deck-test-room-a';
const ROOM_B = 'deck-test-room-b';

let rootDir: string;
let originalFetch: typeof fetch;

function event(params: Record<string, string>, init: {
  method?: string;
  body?: BodyInit;
  roomId?: string;
  kind?: string;
} = {}) {
  return {
    params,
    url: new URL(`https://ant.example.test/api/decks/${params.slug ?? 'deck'}`),
    request: new Request('https://ant.example.test/api/decks', {
      method: init.method ?? 'GET',
      body: init.body,
    }),
    locals: init.roomId ? { roomScope: { roomId: init.roomId, kind: init.kind ?? 'cli' } } : {},
  } as any;
}

async function expectStatus(promiseOrFn: Promise<unknown> | (() => unknown), status: number) {
  try {
    if (typeof promiseOrFn === 'function') {
      await promiseOrFn();
    } else {
      await promiseOrFn;
    }
  } catch (err: any) {
    expect(err?.status).toBe(status);
    return;
  }
  throw new Error(`Expected status ${status}`);
}

function resetDb() {
  const db = getDb();
  db.prepare('DELETE FROM decks WHERE slug IN (?, ?)').run('team-deck', 'auto-deck');
  db.prepare('DELETE FROM sessions WHERE id IN (?, ?)').run(ROOM_A, ROOM_B);
  queries.createSession(ROOM_A, 'Deck Room A', 'chat', 'forever', null, rootDir, '{}');
  queries.createSession(ROOM_B, 'Deck Room B', 'chat', 'forever', null, rootDir, '{}');
}

describe('deck file API helpers', () => {
  beforeEach(() => {
    originalFetch = globalThis.fetch;
    rootDir = mkdtempSync(join(tmpdir(), 'ant-decks-'));
    process.env.ANT_OPEN_SLIDE_DIR = rootDir;
    process.env.ANT_API_KEY = 'deck-test-cookie-secret';
    resetDb();
    mkdirSync(join(rootDir, 'team-deck', 'slides'), { recursive: true });
    writeFileSync(join(rootDir, 'team-deck', 'slides', 'index.tsx'), 'export default [];\n', 'utf8');
    registerDeck({
      slug: 'team-deck',
      owner_session_id: ROOM_A,
      allowed_room_ids: [ROOM_A],
      deck_dir: join(rootDir, 'team-deck'),
      dev_port: 5176,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    const db = getDb();
    db.prepare('DELETE FROM decks WHERE slug IN (?, ?)').run('team-deck', 'auto-deck');
    db.prepare('DELETE FROM sessions WHERE id IN (?, ?)').run(ROOM_A, ROOM_B);
    rmSync(rootDir, { recursive: true, force: true });
    delete process.env.ANT_OPEN_SLIDE_DIR;
    delete process.env.ANT_API_KEY;
  });

  it('gates listing by room scope and does not disclose unknown decks as forbidden', async () => {
    await expectStatus(() => listFiles(event({ slug: 'team-deck' })), 401);
    await expectStatus(() => listFiles(event({ slug: 'missing-deck' }, { roomId: ROOM_B })), 404);
    await expectStatus(() => listFiles(event({ slug: 'team-deck' }, { roomId: ROOM_B })), 403);

    const response = await listFiles(event({ slug: 'team-deck' }, { roomId: ROOM_A }));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.files.some((file: any) => file.path === 'slides/index.tsx')).toBe(true);
    expect(body.deck.dev_port).toBe(5176);
  });

  it('reads, writes, and deletes deck files inside the registered deck dir', async () => {
    const readResponse = await readFile(event({ slug: 'team-deck', path: 'slides/index.tsx' }, { roomId: ROOM_A }));
    expect(await readResponse.text()).toContain('export default');

    const writeResponse = await writeFile(event(
      { slug: 'team-deck', path: 'slides/new.tsx' },
      { roomId: ROOM_A, method: 'PUT', body: 'const slide = true;\n' },
    ));
    expect((await writeResponse.json()).path).toBe('slides/new.tsx');
    expect(readFileSync(join(rootDir, 'team-deck', 'slides', 'new.tsx'), 'utf8')).toContain('slide');

    const deleteResponse = await deleteFile(event({ slug: 'team-deck', path: 'slides/new.tsx' }, { roomId: ROOM_A, method: 'DELETE' }));
    expect((await deleteResponse.json()).ok).toBe(true);
  });

  it('rejects traversal and read-only web-token writes', async () => {
    await expectStatus(() => readFile(event({ slug: 'team-deck', path: '../secrets.txt' }, { roomId: ROOM_A })), 400);
    await expectStatus(writeFile(event(
      { slug: 'team-deck', path: 'slides/nope.tsx' },
      { roomId: ROOM_A, kind: 'web', method: 'PUT', body: 'nope' },
    )), 403);
  });

  it('rejects symlink paths even when their text path is inside the deck dir', async () => {
    const outsideDir = mkdtempSync(join(tmpdir(), 'ant-decks-outside-'));
    writeFileSync(join(outsideDir, 'secret.txt'), 'outside', 'utf8');
    symlinkSync(outsideDir, join(rootDir, 'team-deck', 'linked-out'));
    await expectStatus(() => readFile(event({ slug: 'team-deck', path: 'linked-out/secret.txt' }, { roomId: ROOM_A })), 400);
    await expectStatus(writeFile(event(
      { slug: 'team-deck', path: 'linked-out/new.tsx' },
      { roomId: ROOM_A, method: 'PUT', body: 'nope' },
    )), 400);
    rmSync(outsideDir, { recursive: true, force: true });
  });

  it('auto-registers an existing deck directory on first write by a room-scoped agent', async () => {
    mkdirSync(join(rootDir, 'auto-deck'), { recursive: true });
    const response = await writeFile(event(
      { slug: 'auto-deck', path: 'slides/index.tsx' },
      { roomId: ROOM_A, method: 'PUT', body: 'export default [];\n' },
    ));
    expect((await response.json()).ok).toBe(true);

    const deck = readDeckMeta('auto-deck');
    expect(deck?.owner_session_id).toBe(ROOM_A);
    expect(deck?.allowed_room_ids).toEqual([ROOM_A]);
  });

  it('gates the deck viewer with invite-token login and proxies through the deck path', async () => {
    const invite = createInvite({
      roomId: ROOM_A,
      label: 'Deck viewer',
      password: 'view-pass',
      kinds: ['cli'],
      createdBy: 'test',
    });
    const token = exchangePassword({
      inviteId: invite.id,
      password: 'view-pass',
      kind: 'cli',
      handle: '@deck-agent',
    });
    expect(token).toBeTruthy();

    const loginAttempt = await loginDeck({
      params: { slug: 'team-deck' },
      url: new URL('https://ant.example.test/deck/team-deck/login'),
      request: new Request('https://ant.example.test/deck/team-deck/login', {
        method: 'POST',
        body: new URLSearchParams({ token: 'bad-token' }),
      }),
      cookies: { set: () => {}, get: () => undefined },
    } as any);
    expect(loginAttempt.status).toBe(401);
    expect(await loginAttempt.text()).toContain('Invalid, expired, or revoked invite token');

    const issued: Record<string, string> = {};
    await expectStatus(() => loginDeck({
      params: { slug: 'team-deck' },
      url: new URL('https://ant.example.test/deck/team-deck/login'),
      request: new Request('https://ant.example.test/deck/team-deck/login', {
        method: 'POST',
        body: new URLSearchParams({ token: token!.token }),
      }),
      cookies: { set: (name: string, value: string) => { issued[name] = value; }, get: () => undefined },
    } as any), 302);
    expect(Object.keys(issued)).toContain('ant-deck-team-deck');

    const deck = readDeckMeta('team-deck')!;
    const cookie = createDeckCookie('team-deck', token!.tokenId).value;
    globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
      expect(String(url)).toBe('http://127.0.0.1:5176/slides');
      expect((init?.headers as Headers).get('host')).toBe('localhost:5176');
      return new Response('<script type="module">import RefreshRuntime from "/@react-refresh"</script><script type="module" src="/@vite/client"></script>', {
        headers: { 'Content-Type': 'text/html; charset=utf-8' },
      });
    }) as typeof fetch;

    const response = await proxyDeck({
      params: { slug: deck.slug, path: 'slides' },
      url: new URL('https://ant.example.test/deck/team-deck/slides'),
      request: new Request('https://ant.example.test/deck/team-deck/slides'),
      cookies: { get: (name: string) => (name === 'ant-deck-team-deck' ? cookie : undefined) },
    } as any);
    expect(response.status).toBe(200);
    const html = await response.text();
    expect(html).toContain('from "/deck/team-deck/@react-refresh"');
    expect(html).toContain('src="/deck/team-deck/@vite/client"');
  });
});
