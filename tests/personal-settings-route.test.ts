import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GET, POST } from '../src/routes/api/personal-settings/+server.js';

let tempDir = '';
let originalSettingsFile: string | undefined;

function settingsPath(): string {
  return join(tempDir, 'nested', 'personal-settings.json');
}

function postEvent(body: unknown) {
  return {
    request: new Request('https://ant.test/api/personal-settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
  } as any;
}

beforeEach(() => {
  originalSettingsFile = process.env.ANT_PERSONAL_SETTINGS_FILE;
  tempDir = mkdtempSync(join(tmpdir(), 'ant-personal-settings-'));
  process.env.ANT_PERSONAL_SETTINGS_FILE = settingsPath();
});

afterEach(() => {
  if (originalSettingsFile === undefined) delete process.env.ANT_PERSONAL_SETTINGS_FILE;
  else process.env.ANT_PERSONAL_SETTINGS_FILE = originalSettingsFile;
  rmSync(tempDir, { recursive: true, force: true });
  tempDir = '';
});

describe('/api/personal-settings', () => {
  it('returns seeded defaults when no personal settings file exists', async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.path).toBe(settingsPath());
    expect(body.settings.shortcuts.chatrooms.length).toBeGreaterThan(0);
    expect(body.settings.shortcuts.linkedChats.length).toBeGreaterThan(0);
    expect(body.settings.preferences).toEqual({});
  });

  it('sanitizes and persists posted settings to the request-time configured path', async () => {
    const response = await POST(postEvent({
      settings: {
        shortcuts: {
          chatrooms: [
            {
              id: '  greet  ',
              label: '  Greet  ',
              icon: '',
              command: 'Hello room',
              color: '#ABCDEF',
            },
            { label: '', command: 'skip me' },
          ],
          linkedChats: [
            {
              label: 'Run tests',
              command: 'npm test',
              color: 'not-a-color',
            },
          ],
        },
        preferences: { terminalEmulator: 'Ghostty' },
      },
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.path).toBe(settingsPath());
    expect(body.settings.shortcuts.chatrooms).toEqual([
      {
        id: 'greet',
        label: 'Greet',
        icon: '⚡',
        command: 'Hello room',
        color: '#ABCDEF',
      },
    ]);
    expect(body.settings.shortcuts.linkedChats).toEqual([
      {
        id: 'shortcut-1',
        label: 'Run tests',
        icon: '⚡',
        command: 'npm test',
        color: '#6366F1',
      },
    ]);
    expect(JSON.parse(readFileSync(settingsPath(), 'utf8'))).toEqual(body.settings);
  });

  it('rejects invalid POST JSON and invalid stored JSON', async () => {
    const badPost = await POST(postEvent('{'));
    expect(badPost.status).toBe(400);
    expect(await badPost.json()).toEqual({ error: 'Invalid JSON' });

    mkdirSync(join(tempDir, 'nested'), { recursive: true });
    writeFileSync(settingsPath(), '{', 'utf8');
    const badGet = await GET();
    expect(badGet.status).toBe(400);
    const body = await badGet.json();
    expect(body.error).toContain('Invalid personal settings');
    expect(body.settings.shortcuts.chatrooms.length).toBeGreaterThan(0);
  });
});
