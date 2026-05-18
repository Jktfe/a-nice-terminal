import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET } = await import('../src/routes/api/sessions/[id]/commands/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function commandsEvent(id: string, query = '', locals = {}) {
  return {
    params: { id },
    url: new URL(`https://ant.test/api/sessions/${id}/commands${query}`),
    locals,
  } as any;
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

describe('/api/sessions/:id/commands', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-commands-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    queries.createSession('terminal-a', 'Terminal A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('archived-a', 'Archived A', 'terminal', 'forever', null, null, '{}');
    queries.createSession('deleted-a', 'Deleted A', 'terminal', 'forever', null, null, '{}');
    queries.archiveSession('archived-a');
    queries.softDeleteSession('deleted-a');
    queries.insertCommand('terminal-a', 'npm test', '/repo', 0, '2026-05-18T01:00:00.000Z', '2026-05-18T01:00:01.000Z', 1_000, 'pass');
    queries.insertCommand('terminal-a', 'npm run build', '/repo', 0, '2026-05-18T02:00:00.000Z', '2026-05-18T02:00:03.000Z', 3_000, 'built');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns newest command events first and respects positive limits', async () => {
    const response = await GET(commandsEvent('terminal-a', '?limit=1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toHaveLength(1);
    expect(body[0]).toMatchObject({
      session_id: 'terminal-a',
      command: 'npm run build',
      cwd: '/repo',
      exit_code: 0,
      output_snippet: 'built',
    });
  });

  it('defaults invalid, zero, and negative limits instead of hiding history', async () => {
    for (const query of ['?limit=not-a-number', '?limit=0', '?limit=-5']) {
      const response = await GET(commandsEvent('terminal-a', query));
      const body = await response.json();

      expect(response.status).toBe(200);
      expect(body.map((row: any) => row.command)).toEqual(['npm run build', 'npm test']);
    }
  });

  it('rejects missing and inactive sessions', async () => {
    await expectHttpError(() => GET(commandsEvent('missing')), 404);
    await expectHttpError(() => GET(commandsEvent('archived-a')), 410);
    await expectHttpError(() => GET(commandsEvent('deleted-a')), 410);
  });

  it('rejects cross-room scoped tokens before listing command history', async () => {
    await expectHttpError(
      () =>
        GET(
          commandsEvent('terminal-a', '', {
            roomScope: { roomId: 'archived-a', kind: 'cli' },
          }),
        ),
      403,
    );
  });
});
