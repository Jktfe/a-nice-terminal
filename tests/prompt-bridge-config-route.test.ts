import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';
import { GET, PUT } from '../src/routes/api/prompt-bridge/config/+server.js';

let dataDir = '';
let originalDataDir: string | undefined;

function putEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/prompt-bridge/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

describe('/api/prompt-bridge/config', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-prompt-bridge-config-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns default config when no setting has been saved', async () => {
    const response = GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toMatchObject({
      enabled: false,
      audit: true,
      default_targets: [{ kind: 'linked_chat' }],
      routes: {},
      detect: {
        min_interval_ms: 30_000,
        window_lines: 12,
      },
    });
    expect(body.config.detect.patterns.length).toBeGreaterThan(0);
  });

  it('normalizes and persists PUT config bodies', async () => {
    const response = await PUT(putEvent({
      config: {
        enabled: true,
        audit: false,
        default_targets: [
          { kind: 'linked_chat' },
          { kind: 'chat', session_id: '  zj4jlety9q  ' },
          { kind: 'webhook', url: 'https://hooks.example/ant' },
          { kind: 'webhook', url: 'file:///tmp/nope' },
        ],
        routes: {
          codex: [
            { kind: 'chat', session_id: '  lz0udiayuh  ' },
            { kind: 'bad' },
          ],
        },
        detect: {
          min_interval_ms: 1234,
          window_lines: 7,
          patterns: ['confirm\\?'],
        },
      },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.config).toEqual({
      enabled: true,
      audit: false,
      default_targets: [
        { kind: 'linked_chat' },
        { kind: 'chat', session_id: 'zj4jlety9q' },
        { kind: 'webhook', url: 'https://hooks.example/ant' },
      ],
      routes: {
        codex: [{ kind: 'chat', session_id: 'lz0udiayuh' }],
      },
      detect: {
        min_interval_ms: 1234,
        window_lines: 7,
        patterns: ['confirm\\?'],
      },
    });
    expect(JSON.parse(queries.getSetting('prompt_bridge') as string)).toEqual(body.config);
  });

  it('rejects malformed PUT JSON without mutating the saved config', async () => {
    await PUT(putEvent({ config: { enabled: true } }));

    const response = await PUT(putEvent('{'));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: 'Invalid JSON' });

    const after = GET();
    expect((await after.json()).config.enabled).toBe(true);
  });
});
