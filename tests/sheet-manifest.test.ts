import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import {
  SheetConflictError,
  deleteSheetPath,
  listSheetFiles,
  readSheetAudit,
  readSheetBytes,
  readSheetManifest,
  registerSheet,
  sha256Bytes,
  writeSheetBytes,
  writeSheetManifest,
} from '../src/lib/server/sheets.js';
import {
  GET as readFile,
  PUT as writeFile,
} from '../src/routes/api/sheets/[slug]/files/[...path]/+server.js';

const ROOM = 'sheet-manifest-room';
const SLUG = 'manifest-sheet';
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
  const url = new URL(`https://ant.example.test/api/sheets/${params.slug ?? 'sheet'}/files/${params.path ?? ''}${search}`);
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
  db.prepare('DELETE FROM sheets WHERE slug = ?').run(SLUG);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(ROOM);
  queries.createSession(ROOM, 'Manifest Room', 'chat', 'forever', null, rootDir, '{}');
}

describe('sheet manifest + write guard', () => {
  beforeEach(() => {
    rootDir = mkdtempSync(join(tmpdir(), 'ant-sheet-manifest-'));
    process.env.ANT_OPEN_SLIDE_DIR = rootDir;
    process.env.ANT_API_KEY = 'sheet-manifest-test-secret';
    resetDb();
    mkdirSync(join(rootDir, SLUG), { recursive: true });
    registerSheet({
      slug: SLUG,
      owner_session_id: ROOM,
      allowed_room_ids: [ROOM],
      sheet_dir: join(rootDir, SLUG),
    });
  });

  afterEach(() => {
    const db = getDb();
    db.prepare('DELETE FROM sheets WHERE slug = ?').run(SLUG);
    db.prepare('DELETE FROM sessions WHERE id = ?').run(ROOM);
    rmSync(rootDir, { recursive: true, force: true });
    delete process.env.ANT_OPEN_SLIDE_DIR;
    delete process.env.ANT_API_KEY;
  });

  it('writeSheetBytes creates a manifest entry with sha256 on first write', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const result = writeSheetBytes(sheet, 'data/sheet.csv', Buffer.from('a,b,c\n1,2,3\n', 'utf8'));
    expect(result.sha256).toBe(sha256Bytes(Buffer.from('a,b,c\n1,2,3\n', 'utf8')));

    const manifest = readSheetManifest(sheet);
    expect(manifest).not.toBeNull();
    expect(manifest!.schema_version).toBe(1);
    expect(manifest!.slug).toBe(SLUG);
    expect(manifest!.kind).toBe('ant-open-slide-sheet');
    expect(manifest!.files.find((f) => f.path === 'data/sheet.csv')?.sha256).toBe(result.sha256);
  });

  it('writeSheetBytes with matching base_hash succeeds and updates manifest', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const first = writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    const second = writeSheetBytes(sheet, 'a.csv', Buffer.from('bravo', 'utf8'), { base_hash: first.sha256 });
    expect(second.sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
    expect(readSheetManifest(sheet)!.files.find((f) => f.path === 'a.csv')?.sha256).toBe(second.sha256);
  });

  it('writeSheetBytes with mismatching base_hash throws SheetConflictError', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    expect(() =>
      writeSheetBytes(sheet, 'a.csv', Buffer.from('charlie', 'utf8'), { base_hash: 'deadbeef' })
    ).toThrow(SheetConflictError);
    expect(readFileSync(join(rootDir, SLUG, 'a.csv'), 'utf8')).toBe('alpha');
  });

  it('writeSheetBytes without guard succeeds (back-compat)', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    const second = writeSheetBytes(sheet, 'a.csv', Buffer.from('bravo', 'utf8'));
    expect(second.sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
  });

  it('writeSheetBytes with matching if_match_mtime succeeds', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const first = writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    const second = writeSheetBytes(sheet, 'a.csv', Buffer.from('bravo', 'utf8'), { if_match_mtime: first.mtime_ms });
    expect(second.sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
  });

  it('writeSheetBytes with mismatching if_match_mtime throws SheetConflictError', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    expect(() =>
      writeSheetBytes(sheet, 'a.csv', Buffer.from('charlie', 'utf8'), { if_match_mtime: 1 })
    ).toThrow(SheetConflictError);
  });

  it('deleteSheetPath with matching base_hash succeeds and removes manifest entry', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const first = writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    deleteSheetPath(sheet, 'a.csv', { base_hash: first.sha256 });
    expect(readSheetManifest(sheet)!.files.find((f) => f.path === 'a.csv')).toBeUndefined();
  });

  it('deleteSheetPath with mismatching base_hash throws SheetConflictError and keeps file', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    expect(() => deleteSheetPath(sheet, 'a.csv', { base_hash: 'deadbeef' })).toThrow(SheetConflictError);
    expect(readFileSync(join(rootDir, SLUG, 'a.csv'), 'utf8')).toBe('alpha');
  });

  it('audit jsonl records file_write and conflict events', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'), { actor: 'cli:room-a' });
    expect(() =>
      writeSheetBytes(sheet, 'a.csv', Buffer.from('charlie', 'utf8'), { base_hash: 'deadbeef', actor: 'cli:room-a' })
    ).toThrow(SheetConflictError);
    const entries = readSheetAudit(sheet);
    const types = entries.map((e) => e.type);
    expect(types).toContain('file_write');
    expect(types).toContain('conflict');
    const conflict = entries.find((e) => e.type === 'conflict')!;
    expect(conflict.actor).toBe('cli:room-a');
    expect(conflict.path).toBe('a.csv');
  });

  it('audit jsonl entries append artifact run_events for evidence timelines', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const written = writeSheetBytes(sheet, 'data/sheet.csv', Buffer.from('alpha', 'utf8'), { actor: 'cli:room-a' });

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
      text: 'file_write manifest-sheet/data/sheet.csv',
    });
    expect(row.raw_ref).toContain('sheet_audit:manifest-sheet:');
    expect(JSON.parse(row.payload)).toMatchObject({
      sheet_slug: SLUG,
      audit_type: 'file_write',
      actor: 'cli:room-a',
      path: 'data/sheet.csv',
      sha256: written.sha256,
      details: {
        sha256: written.sha256,
      },
    });
  });

  it('cleanSheetPath rejects writes to the manifest filename and audit dir', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    expect(() => writeSheetBytes(sheet, '.ant-sheet.json', Buffer.from('{}', 'utf8'))).toThrow(/internal metadata|not editable/i);
    expect(() => writeSheetBytes(sheet, '.ant-sheet/audit.jsonl', Buffer.from('x', 'utf8'))).toThrow(/internal metadata|not editable/i);
  });

  it('listSheetFiles excludes the manifest from listing', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    writeSheetManifest(sheet);
    const files = listSheetFiles(sheet).map((f) => f.path);
    expect(files).not.toContain('.ant-sheet.json');
    expect(files).not.toContain('.ant-sheet');
    expect(files).toContain('a.csv');
  });

  it('writeSheetManifest snapshots all files with sha256 + size + mtime', () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    writeSheetBytes(sheet, 'b/c.csv', Buffer.from('beta', 'utf8'));
    const manifest = writeSheetManifest(sheet, {
      source_session_id: ROOM,
      source_evidence_hash: 'abc123',
      generator: { name: 'test', version: '0' },
    });
    expect(manifest.source_evidence_hash).toBe('abc123');
    expect(manifest.generator).toEqual({ name: 'test', version: '0' });
    expect(manifest.files.map((f) => f.path).sort()).toEqual(['a.csv', 'b/c.csv']);
    for (const file of manifest.files) {
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it('route GET sets ETag header with sha256', async () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const written = writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    const response = await readFile(event({ slug: SLUG, path: 'a.csv' }, { roomId: ROOM }));
    expect(response.headers.get('ETag')).toBe(`"${written.sha256}"`);
    expect(response.headers.get('X-ANT-Sheet-Sha256')).toBe(written.sha256);
  });

  it('route PUT with matching x-ant-base-hash succeeds, mismatching returns 409', async () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const first = writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));

    const okResponse = await writeFile(event(
      { slug: SLUG, path: 'a.csv' },
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
      { slug: SLUG, path: 'a.csv' },
      {
        method: 'PUT',
        roomId: ROOM,
        body: 'charlie',
        headers: { 'x-ant-base-hash': 'deadbeef' },
      },
    )), 409);
    expect(readSheetBytes(sheet, 'a.csv').sha256).toBe(sha256Bytes(Buffer.from('bravo', 'utf8')));
  });

  it('route PUT without base_hash succeeds (back-compat)', async () => {
    const response = await writeFile(event(
      { slug: SLUG, path: 'a.csv' },
      { method: 'PUT', roomId: ROOM, body: 'alpha' },
    ));
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.sha256).toBe(sha256Bytes(Buffer.from('alpha', 'utf8')));
  });

  it('route PUT accepts ?base_hash= query as fallback', async () => {
    const sheet = registerSheet({ slug: SLUG, owner_session_id: ROOM });
    const first = writeSheetBytes(sheet, 'a.csv', Buffer.from('alpha', 'utf8'));
    const response = await writeFile(event(
      { slug: SLUG, path: 'a.csv' },
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
