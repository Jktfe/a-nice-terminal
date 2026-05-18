import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const { GET, POST } = await import('../src/routes/api/sessions/[id]/share/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;
let originalPublicOrigin: string | undefined;
let originalServerUrl: string | undefined;

function shareEvent(
  id: string,
  url = `https://request-origin.test/api/sessions/${id}/share`,
  locals: Record<string, unknown> = {},
) {
  return {
    params: { id },
    url: new URL(url),
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

describe('/api/sessions/:id/share', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    originalPublicOrigin = process.env.ANT_PUBLIC_ORIGIN;
    originalServerUrl = process.env.ANT_SERVER_URL;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-session-share-'));
    process.env.ANT_DATA_DIR = dataDir;
    delete process.env.ANT_PUBLIC_ORIGIN;
    delete process.env.ANT_SERVER_URL;
    _resetForTest();
    getDb();
    queries.createSession('terminal-1', 'Terminal One', 'terminal', 'forever', null, null, '{}');
    queries.createSession('chat-1', 'Chat One', 'chat', 'forever', null, null, '{}');
    queries.createSession('agent-1', 'Agent One', 'agent', 'forever', null, null, '{}');
    queries.createSession('archived-1', 'Archived One', 'chat', 'forever', null, null, '{}');
    queries.createSession('deleted-1', 'Deleted One', 'chat', 'forever', null, null, '{}');
    queries.archiveSession('archived-1');
    queries.softDeleteSession('deleted-1');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    if (originalPublicOrigin === undefined) delete process.env.ANT_PUBLIC_ORIGIN;
    else process.env.ANT_PUBLIC_ORIGIN = originalPublicOrigin;
    if (originalServerUrl === undefined) delete process.env.ANT_SERVER_URL;
    else process.env.ANT_SERVER_URL = originalServerUrl;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('returns terminal commands with request-origin health URL fallback', async () => {
    const response = await GET(shareEvent('terminal-1'));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      session_id: 'terminal-1',
      session_name: 'Terminal One',
      session_type: 'terminal',
      commands: {
        connect: 'ant terminal terminal-1',
        watch: 'ant terminal watch terminal-1',
        send: 'ant terminal send terminal-1 --cmd "YOUR_COMMAND"',
        curl_health: 'curl -sk https://request-origin.test/api/sessions/terminal-1',
      },
      quick_join: 'ant terminal terminal-1',
    });
  });

  it('returns chat and agent commands with ANT_PUBLIC_ORIGIN preferred over ANT_SERVER_URL', async () => {
    process.env.ANT_PUBLIC_ORIGIN = 'https://public.example';
    process.env.ANT_SERVER_URL = 'https://server.example:6458';

    const chatResponse = await GET(shareEvent('chat-1'));
    const agentResponse = await GET(shareEvent('agent-1'));

    expect(await chatResponse.json()).toEqual(expect.objectContaining({
      session_id: 'chat-1',
      session_name: 'Chat One',
      session_type: 'chat',
      commands: {
        join: 'ant chat join chat-1',
        send: 'ant chat send chat-1 --msg "YOUR_MESSAGE"',
        read: 'ant chat read chat-1',
        curl_health: 'curl -sk https://public.example/api/sessions/chat-1',
      },
      quick_join: 'ant chat join chat-1',
    }));
    expect(await agentResponse.json()).toEqual(expect.objectContaining({
      session_id: 'agent-1',
      commands: expect.objectContaining({
        join: 'ant chat join agent-1',
        curl_health: 'curl -sk https://public.example/api/sessions/agent-1',
      }),
      quick_join: 'ant chat join agent-1',
    }));
  });

  it('keeps POST output identical to GET for copy-paste clients', async () => {
    const getBody = await (await GET(shareEvent('chat-1'))).json();
    const postBody = await (await POST(shareEvent('chat-1'))).json();

    expect(postBody).toEqual(getBody);
  });

  it('rejects missing, archived, and soft-deleted sessions', async () => {
    await expectHttpError(() => GET(shareEvent('missing')), 404);
    await expectHttpError(() => GET(shareEvent('archived-1')), 410);
    await expectHttpError(() => GET(shareEvent('deleted-1')), 410);
  });

  it('allows same-room scoped readers and rejects cross-room scoped readers', async () => {
    const sameRoom = await GET(shareEvent('chat-1', undefined, {
      roomScope: { roomId: 'chat-1', kind: 'web' },
    }));
    expect(sameRoom.status).toBe(200);
    expect(await sameRoom.json()).toMatchObject({ session_id: 'chat-1' });

    await expectHttpError(
      () => GET(shareEvent('chat-1', undefined, { roomScope: { roomId: 'terminal-1', kind: 'web' } })),
      403,
    );
  });
});
