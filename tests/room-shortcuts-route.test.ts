import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { GET, POST } from '../src/routes/api/room-shortcuts/+server.js';

let tempDir = '';
let originalShortcutsFile: string | undefined;

function shortcutsPath(): string {
  return join(tempDir, 'nested', 'room-shortcuts.json');
}

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/room-shortcuts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

beforeEach(() => {
  originalShortcutsFile = process.env.ANT_ROOM_SHORTCUTS_FILE;
  tempDir = mkdtempSync(join(tmpdir(), 'ant-room-shortcuts-'));
  process.env.ANT_ROOM_SHORTCUTS_FILE = shortcutsPath();
});

afterEach(() => {
  if (originalShortcutsFile === undefined) delete process.env.ANT_ROOM_SHORTCUTS_FILE;
  else process.env.ANT_ROOM_SHORTCUTS_FILE = originalShortcutsFile;
  rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('/api/room-shortcuts', () => {
  it('returns an empty list when no shortcuts file exists', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ shortcuts: [] });
  });

  it('sanitizes and persists shortcuts to the request-time configured path', async () => {
    const response = await POST(postEvent({
      shortcuts: [
        {
          id: '  antv4  ',
          label: '  antv4  ',
          icon: '',
          sessionId: '  zj4jlety9q  ',
          color: '#ABCDEF',
        },
        { label: 'Missing session', sessionId: '   ' },
        {
          label: 'Asks',
          sessionId: 'lz0udiayuh',
          color: 'not-a-color',
        },
      ],
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.shortcuts).toEqual([
      {
        id: 'antv4',
        label: 'antv4',
        icon: '💬',
        sessionId: 'zj4jlety9q',
        color: '#ABCDEF',
      },
      {
        id: 'room-3',
        label: 'Asks',
        icon: '💬',
        sessionId: 'lz0udiayuh',
        color: '#6366F1',
      },
    ]);
    expect(JSON.parse(readFileSync(shortcutsPath(), 'utf8'))).toEqual({ shortcuts: body.shortcuts });
  });

  it('accepts the legacy array body shape', async () => {
    const response = await POST(postEvent([
      { label: 'Dashboard', sessionId: 'home', icon: '🏠', color: '#123456' },
    ]));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      shortcuts: [
        {
          id: 'room-1',
          label: 'Dashboard',
          icon: '🏠',
          sessionId: 'home',
          color: '#123456',
        },
      ],
    });
  });

  it('rejects invalid POST JSON and invalid body shape', async () => {
    const invalidJson = await POST(postEvent('{'));
    expect(invalidJson.status).toBe(400);
    expect(await invalidJson.json()).toEqual({ error: 'Invalid JSON' });

    const invalidShape = await POST(postEvent({ shortcuts: 'not-an-array' }));
    expect(invalidShape.status).toBe(400);
    expect(await invalidShape.json()).toEqual({ error: 'Expected { shortcuts: [...] }' });
  });

  it('returns a 400 when the configured shortcuts file contains invalid JSON', async () => {
    mkdirSync(dirname(shortcutsPath()), { recursive: true });
    writeFileSync(shortcutsPath(), '{', 'utf8');

    const response = await GET();
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      shortcuts: [],
      error: 'Invalid room shortcuts config',
    });
  });
});
