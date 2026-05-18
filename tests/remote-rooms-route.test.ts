import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tempDir = '';
let originalHome: string | undefined;

function configPath(): string {
  return join(tempDir, '.ant', 'config.json');
}

function event(locals: Record<string, unknown> = {}) {
  return { locals } as any;
}

async function loadRoute() {
  vi.resetModules();
  return import('../src/routes/api/remote-rooms/+server.js');
}

async function expectHttpError(action: () => unknown | Promise<unknown>, status: number) {
  try {
    await action();
  } catch (err) {
    expect(err).toMatchObject({ status });
    return;
  }
  throw new Error(`Expected HTTP ${status}`);
}

describe('/api/remote-rooms', () => {
  beforeEach(() => {
    originalHome = process.env.HOME;
    tempDir = mkdtempSync(join(tmpdir(), 'ant-remote-rooms-'));
    mkdirSync(join(tempDir, '.ant'), { recursive: true });
    process.env.HOME = tempDir;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(tempDir, { recursive: true, force: true });
    tempDir = '';
  });

  it('lists remote rooms for admin callers without exposing bearer tokens', async () => {
    writeFileSync(configPath(), JSON.stringify({
      tokens: {
        older: {
          room_id: 'older',
          server_url: 'https://old.example',
          token: 'ant_t_secret_old',
          token_id: 'tok-old',
          invite_id: 'inv-old',
          kind: 'web',
          handle: '@you',
          joined_at: '2026-05-17T10:00:00.000Z',
          label: 'Older room',
        },
        newer: {
          room_id: 'newer',
          server_url: 'https://new.example',
          token: 'ant_t_secret_new',
          token_id: 'tok-new',
          invite_id: 'inv-new',
          kind: 'cli',
          handle: '@evolveantcodex',
          joined_at: '2026-05-18T10:00:00.000Z',
          label: 'Newer room',
        },
      },
    }), 'utf8');

    const { GET } = await loadRoute();
    const response = GET(event());

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.rooms.map((room: any) => room.room_id)).toEqual(['newer', 'older']);
    expect(body.rooms[0]).toEqual({
      room_id: 'newer',
      server_url: 'https://new.example',
      kind: 'cli',
      handle: '@evolveantcodex',
      joined_at: '2026-05-18T10:00:00.000Z',
      label: 'Newer room',
      server_url_inferred: false,
    });
    expect(JSON.stringify(body)).not.toContain('ant_t_secret');
    expect(JSON.stringify(body)).not.toContain('tok-new');
    expect(JSON.stringify(body)).not.toContain('inv-new');
  });

  it('rejects room-scoped callers', async () => {
    const { GET } = await loadRoute();

    await expectHttpError(
      () => GET(event({ roomScope: { roomId: 'lz0udiayuh', kind: 'cli' } })),
      403,
    );
  });

  it('migrates legacy token entries using the top-level serverUrl once', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    writeFileSync(configPath(), JSON.stringify({
      serverUrl: 'https://legacy.example',
      tokens: {
        legacy: {
          token: 'ant_t_legacy',
          token_id: 'tok-legacy',
          invite_id: 'inv-legacy',
          kind: 'cli',
          handle: '@you',
          joined_at: '2026-05-18T09:00:00.000Z',
        },
      },
    }), 'utf8');

    const { GET } = await loadRoute();
    const response = GET(event());
    const body = await response.json();

    expect(body.rooms).toMatchObject([
      {
        room_id: 'legacy',
        server_url: 'https://legacy.example',
        server_url_inferred: true,
      },
    ]);
    const persisted = JSON.parse(readFileSync(configPath(), 'utf8'));
    expect(persisted.tokens.legacy.server_url).toBe('https://legacy.example');
    expect(persisted.tokens.legacy.server_url_inferred).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
