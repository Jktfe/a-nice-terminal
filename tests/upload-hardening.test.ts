import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const ENV_KEYS = [
  'ANT_DATA_DIR',
  'ANT_API_KEY',
  'MAX_FILE_SIZE_MB',
  'UPLOAD_RATE_LIMIT_PER_HANDLE',
  'UPLOAD_DAILY_BYTES_PER_HANDLE',
  'UPLOAD_MIME_ALLOWLIST',
] as const;

const originalCwd = process.cwd();
const originalEnv = new Map<string, string | undefined>(ENV_KEYS.map((key) => [key, process.env[key]]));
const tempDirs: string[] = [];

function restoreEnv() {
  for (const key of ENV_KEYS) {
    const original = originalEnv.get(key);
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
}

function closeDb() {
  const globalDb = (globalThis as any).__ant_db__;
  try { globalDb?.close?.(); } catch {}
  delete (globalThis as any).__ant_db__;
}

async function freshWorkspace() {
  closeDb();
  vi.resetModules();
  const dir = await mkdtemp(join(tmpdir(), 'ant-upload-test-'));
  tempDirs.push(dir);
  process.env.ANT_DATA_DIR = join(dir, 'data');
  process.chdir(dir);
  const db = await import('../src/lib/server/db');
  const route = await import('../src/routes/api/upload/+server');
  return { dir, queries: db.queries, POST: route.POST };
}

function makeUploadEvent(url: string, bytes: Uint8Array, headers: Record<string, string> = {}) {
  const form = new FormData();
  const fileBytes = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  form.append('file', new File([fileBytes], 'proof.png', { type: 'image/png' }));
  const request = new Request(url, {
    method: 'POST',
    headers,
    body: form,
  });
  return {
    request,
    url: new URL(url),
    locals: {},
  } as any;
}

function createHandledSession(queries: any, id = 'session-james') {
  queries.createSession(id, 'James terminal', 'terminal', 'forever', null, null, '{}');
  queries.setHandle(id, '@james', 'James');
  return id;
}

afterEach(async () => {
  process.chdir(originalCwd);
  restoreEnv();
  closeDb();
  vi.resetModules();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('upload hardening policy', () => {
  it('keeps limits configurable while defaulting registered handles to generous local use', async () => {
    const { getUploadPolicy, isMimeAllowed } = await import('../src/lib/server/uploads');

    const defaults = getUploadPolicy();
    expect(defaults.maxFileSizeMb).toBeGreaterThanOrEqual(100);
    expect(defaults.rateLimitPerHandle).toBeGreaterThanOrEqual(1000);
    expect(defaults.dailyBytesPerHandle).toBeGreaterThanOrEqual(100 * 1024 * 1024 * 1024);
    expect(isMimeAllowed('image/png', defaults.mimeAllowlist)).toBe(true);
    expect(isMimeAllowed('text/markdown', defaults.mimeAllowlist)).toBe(true);
    expect(isMimeAllowed('application/pdf', defaults.mimeAllowlist)).toBe(true);
    expect(isMimeAllowed('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', defaults.mimeAllowlist)).toBe(true);
    expect(isMimeAllowed('application/vnd.openxmlformats-officedocument.wordprocessingml.document', defaults.mimeAllowlist)).toBe(true);

    process.env.MAX_FILE_SIZE_MB = '2';
    process.env.UPLOAD_RATE_LIMIT_PER_HANDLE = '3';
    process.env.UPLOAD_DAILY_BYTES_PER_HANDLE = '4096';
    process.env.UPLOAD_MIME_ALLOWLIST = 'image/png,text/plain';

    const policy = getUploadPolicy();
    expect(policy.maxFileSizeBytes).toBe(2 * 1024 * 1024);
    expect(policy.rateLimitPerHandle).toBe(3);
    expect(policy.dailyBytesPerHandle).toBe(4096);
    expect(isMimeAllowed('text/plain', policy.mimeAllowlist)).toBe(true);
    expect(isMimeAllowed('image/jpeg', policy.mimeAllowlist)).toBe(false);
  });

  it('returns 401 for anonymous uploads before creating a local file', async () => {
    const { dir, POST } = await freshWorkspace();
    const event = makeUploadEvent('http://localhost/api/upload', new TextEncoder().encode('anonymous'), {
      origin: 'http://localhost',
    });

    await expect(POST(event)).rejects.toMatchObject({ status: 401 });
    expect(existsSync(join(dir, 'static', 'uploads'))).toBe(false);
  });

  it('accepts an authenticated ANT session upload and records SHA-256 audit evidence', async () => {
    const { dir, queries, POST } = await freshWorkspace();
    const sessionId = createHandledSession(queries);
    const bytes = new TextEncoder().encode('authenticated image payload');
    const hash = createHash('sha256').update(bytes).digest('hex');

    const response = await POST(makeUploadEvent('http://localhost/api/upload', bytes, {
      origin: 'http://localhost',
      referer: `http://localhost/session/${sessionId}`,
    }));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toMatchObject({
      url: `/uploads/${hash}.png`,
      markdown: `![image](/uploads/${hash}.png)`,
      session_id: sessionId,
      handle: '@james',
      hash,
      size: bytes.length,
    });

    const saved = await readFile(join(dir, 'static', 'uploads', `${hash}.png`));
    expect(Buffer.compare(saved, Buffer.from(bytes))).toBe(0);

    const [row] = queries.listUploadsForSession(sessionId);
    expect(row).toMatchObject({
      session_id: sessionId,
      uploader_handle: '@james',
      original_name: 'proof.png',
      mime_type: 'image/png',
      content_hash: hash,
      size_bytes: bytes.length,
      storage_path: join('static', 'uploads', `${hash}.png`),
      public_url: `/uploads/${hash}.png`,
    });
    expect(row.created_at).toBeTruthy();
  });

  it('accepts a registered ANT handle identity without adding a new auth surface', async () => {
    const { queries, POST } = await freshWorkspace();
    const sessionId = createHandledSession(queries);
    const bytes = new TextEncoder().encode('handle-authenticated image payload');
    const hash = createHash('sha256').update(bytes).digest('hex');

    const response = await POST(makeUploadEvent('http://localhost/api/upload?handle=%40james', bytes, {
      origin: 'http://localhost',
    }));
    expect(response.status).toBe(200);

    const payload = await response.json();
    expect(payload).toMatchObject({
      url: `/uploads/${hash}.png`,
      session_id: sessionId,
      handle: '@james',
      hash,
      size: bytes.length,
    });
  });

  it('enforces the per-handle hourly rate limit from env policy', async () => {
    process.env.UPLOAD_RATE_LIMIT_PER_HANDLE = '1';
    const { queries, POST } = await freshWorkspace();
    const sessionId = createHandledSession(queries);
    const headers = {
      origin: 'http://localhost',
      referer: `http://localhost/session/${sessionId}`,
    };

    const first = await POST(makeUploadEvent('http://localhost/api/upload', new TextEncoder().encode('first'), headers));
    expect(first.status).toBe(200);

    await expect(
      POST(makeUploadEvent('http://localhost/api/upload', new TextEncoder().encode('second'), headers)),
    ).rejects.toMatchObject({ status: 429 });
  });
});
