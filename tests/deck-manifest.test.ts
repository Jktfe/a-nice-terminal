import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import {
  DeckConflictError,
  deleteDeckPath,
  listDeckFiles,
  readDeckAudit,
  readDeckBytes,
  readDeckManifest,
  registerDeck,
  sha256Bytes,
  writeDeckBytes,
  writeDeckManifest,
} from '../src/lib/server/decks.js';
import {
  GET as readFile,
  PUT as writeFile,
} from '../src/routes/api/decks/[slug]/files/[...path]/+server.js';

const ROOM = 'deck-manifest-room';
const SLUG = 'manifest-deck';
let rootDir: string;

function event(params: Record<string, string>, init: {
  method?: string;
  body?: BodyInit;
  roomId?: string;
  kind?: string;
  headers?: Record<string, string>;
  search?: string;
} = {}) {
  const search = init.search ? `?${init.search}` : '';
  const url = new URL(`https://ant.example.test/api/decks/${params.slug ?? 'deck'}/files/${params.path ?? ''}${search}`);
  return {
    params,
    url,
    request: new Request(url.toString(), {
      method: init.method ?? 'GET',
      body: init.body,
      headers: init.headers,
    }),
    locals: init.roomId ? { roomScope: { roomId: init.roomId, kind: init.kind ?? 'cli' } } : {},
  } as any;
}

async function expectStatus(promiseOrFn: Promise<unknown> | (() => unknown), status: number) {
  try {
    if (typeof promiseOrFn === 'function') await promiseOrFn();
    else await promiseOrFn;
  } catch (err: any) {
    expect(err?.status).toBe(status);
    return;
  }
  throw new Error(`Expected status ${status}`);
}

function resetDb() {
  const db = getDb();
  db.prepare('DELETE FROM decks WHERE slug = ?').run(SLUG);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(ROOM);
  queries.createSession(ROOM, 'Manifest Room', 'chat', 'forever', null, rootDir, '{}');
}

describe('deck manifest + write guard', () => {
  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'ant-deck-manifest-'));
    process.env.ANT_OPEN_SLIDE_DIR = rootDir;
    process.env.ANT_API_KEY = 'deck-manifest-test-secret';
    resetDb();
    mkdirSync(join(rootDir, SLUG), { recursive: true });
    registerDeck({
      slug: SLUG,
      owner_session_id: ROOM,
      allowed_room_ids: [ROOM],
      deck_dir: join(rootDir, SLUG),
    });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM decks WHERE slug = ?').run(SLUG);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(ROOM);
    rmSync(rootDir, { recursive: true, force: true });
    delete process.env.ANT_OPEN_SLIDE_DIR;
    delete process.env.ANT_API_KEY;
  });

  it('writeDeckBytes creates a manifest entry with sha256 on first write', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const result = writeDeckBytes(deck, 'slides/index.tsx', Buffer.from('export default [];\n', 'utf8'));
    expect(result.sha256).toBe(sha256Bytes(Buffer.from('export default [];\n', 'utf8')));

    const manifest = readDeckManifest(deck);
    expect(manifest).not.toBeNull();
    expect(manifest!.schema_version).toBe(1);
    expect(manifest!.slug).toBe(SLUG);
    expect(manifest!.files.find((f) => f.path === 'slides/index.tsx')?.sha256).toBe(result.sha256);
  });

  it('writeDeckBytes with matching base_hash succeeds and updates manifest', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const first = writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    const second = writeDeckBytes(deck, 'a.tsx', Buffer.from('bravo', 'utf8'), { base_hash: first.sha256 });
    expect(second.sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
    expect(readDeckManifest(deck)!.files.find((f) => f.path === 'a.tsx')?.sha256).toBe(second.sha256);
  });

  it('writeDeckBytes with mismatching base_hash throws DeckConflictError', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    expect(() =>
      writeDeckBytes(deck, 'a.tsx', Buffer.from('charlie', 'utf8'), { base_hash: 'deadbeef' })
    ).toThrow(DeckConflictError);
    expect(readFileSync(join(rootDir, SLUG, 'a.tsx'), 'utf8')).toBe('alpha');
  });

  it('writeDeckBytes without guard succeeds (back-compat)', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    const second = writeDeckBytes(deck, 'a.tsx', Buffer.from('bravo', 'utf8'));
    expect(second.sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
  });

  it('writeDeckBytes with matching if_match_mtime succeeds', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const first = writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    const second = writeDeckBytes(deck, 'a.tsx', Buffer.from('bravo', 'utf8'), { if_match_mtime: first.mtime_ms });
    expect(second.sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
  });

  it('writeDeckBytes with mismatching if_match_mtime throws DeckConflictError', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    expect(() =>
      writeDeckBytes(deck, 'a.tsx', Buffer.from('charlie', 'utf8'), { if_match_mtime: 1 })
    ).toThrow(DeckConflictError);
  });

  it('deleteDeckPath with matching base_hash succeeds and removes manifest entry', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const first = writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    deleteDeckPath(deck, 'a.tsx', { base_hash: first.sha256 });
    expect(readDeckManifest(deck)!.files.find((f) => f.path === 'a.tsx')).toBeUndefined();
  });

  it('deleteDeckPath with mismatching base_hash throws DeckConflictError and keeps file', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    expect(() => deleteDeckPath(deck, 'a.tsx', { base_hash: 'deadbeef' })).toThrow(DeckConflictError);
    expect(readFileSync(join(rootDir, SLUG, 'a.tsx'), 'utf8')).toBe('alpha');
  });

  it('audit jsonl records file_write and conflict events', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'), { actor: 'cli:room-a' });
    expect(() =>
      writeDeckBytes(deck, 'a.tsx', Buffer.from('charlie', 'utf8'), { base_hash: 'deadbeef', actor: 'cli:room-a' })
    ).toThrow(DeckConflictError);
    const entries = readDeckAudit(deck);
    const types = entries.map((e) => e.type);
    expect(types).toContain('file_write');
    expect(types).toContain('conflict');
    const conflict = entries.find((e) => e.type === 'conflict')!;
    expect(conflict.actor).toBe('cli:room-a');
    expect(conflict.path).toBe('a.tsx');
  });

  it('audit jsonl entries append artifact run_events for evidence timelines', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const written = writeDeckBytes(deck, 'slides/index.tsx', Buffer.from('alpha', 'utf8'), { actor: 'cli:room-a' });

    const row = getDb()
      .prepare(`
        SELECT kind, source, trust, text, payload, raw_ref
          FROM run_events
         WHERE session_id = ?
           AND kind = 'artifact_write'
         ORDER BY id DESC
         LIMIT 1
      `)
      .get(ROOM) as any;
    expect(row).toMatchObject({
      kind: 'artifact_write',
      source: 'json',
      trust: 'high',
      text: 'file_write manifest-deck/slides/index.tsx',
    });
    expect(row.raw_ref).toContain('deck_audit:manifest-deck:');
    expect(JSON.parse(row.payload)).toMatchObject({
      deck_slug: SLUG,
      audit_type: 'file_write',
      actor: 'cli:room-a',
      path: 'slides/index.tsx',
      sha256: written.sha256,
      details: {
        sha256: written.sha256,
      },
    });
  });

  it('cleanDeckPath rejects writes to the manifest filename and audit dir', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    expect(() => writeDeckBytes(deck, '.ant-deck.json', Buffer.from('{}', 'utf8'))).toThrow(/internal metadata|not editable/i);
    expect(() => writeDeckBytes(deck, '.ant-deck/audit.jsonl', Buffer.from('x', 'utf8'))).toThrow(/internal metadata|not editable/i);
  });

  it('listDeckFiles excludes the manifest from listing', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    writeDeckManifest(deck);
    const files = listDeckFiles(deck).map((f) => f.path);
    expect(files).not.toContain('.ant-deck.json');
    expect(files).not.toContain('.ant-deck');
    expect(files).toContain('a.tsx');
  });

  it('writeDeckManifest snapshots all files with sha256 + size + mtime', () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    writeDeckBytes(deck, 'b/c.md', Buffer.from('beta', 'utf8'));
    const manifest = writeDeckManifest(deck, {
      source_session_id: ROOM,
      source_evidence_hash: 'abc123',
      generator: { name: 'test', version: '0' },
    });
    expect(manifest.source_evidence_hash).toBe('abc123');
    expect(manifest.generator).toEqual({ name: 'test', version: '0' });
    expect(manifest.files.map((f) => f.path).sort()).toEqual(['a.tsx', 'b/c.md']);
    for (const file of manifest.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it('route GET sets ETag header with sha256', async () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const written = writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    const response = await readFile(event({ slug: SLUG, path: 'a.tsx' }, { roomId: ROOM }));
    expect(response.headers.get('ETag')).toBe(`"${written.sha256}"`);
    expect(response.headers.get('X-ANT-Deck-Sha256')).toBe(written.sha256);
  });

  it('route PUT with matching x-ant-base-hash succeeds, mismatching returns 409', async () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const first = writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));

    const okResponse = await writeFile(event(
      { slug: SLUG, path: 'a.tsx' },
      {
        method: 'PUT',
        roomId: ROOM,
        body: 'bravo',
        headers: { 'x-ant-base-hash': first.sha256 },
      },
    ));
    const okBody = await okResponse.json();
    expect(okBody.ok).toBe(true);
    expect(okBody.sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));

    await expectStatus(writeFile(event(
      { slug: SLUG, path: 'a.tsx' },
      {
        method: 'PUT',
        roomId: ROOM,
        body: 'charlie',
        headers: { 'x-ant-base-hash': 'deadbeef' },
      },
    )), 409);
    expect(readDeckBytes(deck, 'a.tsx').sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
  });

  it('route PUT without base_hash succeeds (back-compat)', async () => {
    const response = await writeFile(event(
      { slug: SLUG, path: 'a.tsx' },
      { method: 'PUT', roomId: ROOM, body: 'alpha' },
    ));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.sha256).toBe(sha256Bytes(Buffer.from('alpha', 'utf8')));
  });

  it('route PUT accepts ?base_hash= query as fallback', async () => {
    const deck = registerDeck({ slug: SLUG, owner_session_id: ROOM });
    const first = writeDeckBytes(deck, 'a.tsx', Buffer.from('alpha', 'utf8'));
    const response = await writeFile(event(
      { slug: SLUG, path: 'a.tsx' },
      {
        method: 'PUT',
        roomId: ROOM,
        body: 'bravo',
        search: `base_hash=${first.sha256}`,
      },
    ));
    const body = await response.json();
    expect(body.ok).toBe(true);
  });
});
