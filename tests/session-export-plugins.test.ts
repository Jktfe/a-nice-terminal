import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import { writeOpenSlideDeck } from '../src/lib/server/capture/open-slide-writer.js';
import { POST } from '../src/routes/api/sessions/[id]/export/+server.js';

const TEST_SESSION = 'test-session-export-plugins';
let tempDir: string | null = null;
let missingVaultDir: string | null = null;

function resetSession() {
  const db = getDb();
  db.prepare('DELETE FROM sessions WHERE id = ?').run(TEST_SESSION);
  queries.createSession(TEST_SESSION, 'Export Plugin Session', 'chat', 'forever', null, '/tmp/ant-export-test', '{}');
  queries.createMessage(
    'export-plugin-msg-1',
    TEST_SESSION,
    'user',
    'Decision: keep external tools plugin-shaped and evidence-backed.',
    'text',
    'complete',
    '@james',
    null,
    null,
    'message',
    '{}',
  );
  queries.createFileRef('export-plugin-ref-1', TEST_SESSION, '@codex', 'src/lib/server/capture/session-evidence.ts', 'Evidence bundle builder');
  queries.insertCommand(TEST_SESSION, 'bun run test', '/tmp/ant-export-test', 0, '2026-05-04T10:00:00.000Z', '2026-05-04T10:00:02.000Z', 2000, '112 pass');
  queries.appendRunEvent(TEST_SESSION, 1_771_234_500_000, 'json', 'high', 'plan_decision', 'Use Render/Evidence plugins', JSON.stringify({
    plan_id: 'plugins',
    title: 'Use Render/Evidence plugins',
    order: 1,
  }), 'raw:test:1');
}

describe('session evidence plugin exports', () => {
  beforeEach(() => {
    resetSession();
    tempDir = mkdtempSync(join(tmpdir(), 'ant-open-slide-'));
    process.env.ANT_OPEN_SLIDE_DIR = tempDir;
  });

  afterEach(() => {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
    tempDir = null;
    if (missingVaultDir) rmSync(missingVaultDir, { recursive: true, force: true });
    missingVaultDir = null;
    delete process.env.ANT_OBSIDIAN_VAULT;
  });

  afterAll(() => {
    const db = getDb();
    db.prepare('DELETE FROM sessions WHERE id = ?').run(TEST_SESSION);
    delete process.env.ANT_OPEN_SLIDE_DIR;
  });

  it('writes an Open-Slide-ready evidence deck without requiring a render service', () => {
    const result = writeOpenSlideDeck(TEST_SESSION);

    expect(result.ok).toBe(true);
    expect(result.deck_dir).toContain(tempDir);
    expect(result.evidence_path && existsSync(result.evidence_path)).toBe(true);
    expect(result.slides_path && existsSync(result.slides_path)).toBe(true);

    const evidence = readFileSync(result.evidence_path!, 'utf8');
    const slides = readFileSync(result.slides_path!, 'utf8');
    const pkg = JSON.parse(readFileSync(join(result.deck_dir!, 'package.json'), 'utf8'));
    expect(evidence).toContain('Export Plugin Session');
    expect(evidence).toContain('Evidence bundle builder');
    expect(slides).toContain("export default [Cover, TasksAndFiles, Commands, Messages]");
    expect(pkg.scripts.build).toBe('open-slide build');
    expect(pkg.scripts.preview).toBe('open-slide preview');
    expect(pkg.dependencies['@open-slide/core']).toBeTruthy();
    expect(pkg.dependencies['@open-slide/cli']).toBeUndefined();
  });

  it('rejects unknown export targets instead of silently doing nothing', async () => {
    const response = await POST({
      params: { id: TEST_SESSION },
      url: new URL(`https://ant.example.test/api/sessions/${TEST_SESSION}/export`),
      request: new Request('https://ant.example.test/export', {
        method: 'POST',
        body: JSON.stringify({ targets: ['unknown'] }),
      }),
    } as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.error).toContain('Unknown export target');
  });

  it('runs all targets with per-target status when Obsidian is unavailable', async () => {
    missingVaultDir = mkdtempSync(join(tmpdir(), 'ant-missing-vault-'));
    rmSync(missingVaultDir, { recursive: true, force: true });
    process.env.ANT_OBSIDIAN_VAULT = missingVaultDir;

    const response = await POST({
      params: { id: TEST_SESSION },
      url: new URL(`https://ant.example.test/api/sessions/${TEST_SESSION}/export`),
      request: new Request('https://ant.example.test/export', {
        method: 'POST',
        body: JSON.stringify({ targets: ['obsidian', 'open-slide'] }),
      }),
      locals: {},
    } as unknown as Parameters<typeof POST>[0]);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.targets.obsidian).toMatchObject({ ok: false, skipped: true, path: null });
    expect(body.targets.open_slide.ok).toBe(true);
    expect(body.targets.open_slide.deck_dir).toContain(tempDir);
  });
});
