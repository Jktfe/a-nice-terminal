import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import getDb, { _resetForTest, queries } from '../src/lib/server/db.js';

const writes: Array<{ id: string; data: string }> = [];
const capturePromptInput = vi.fn();

vi.mock('$lib/server/pty-client.js', () => ({
  ptyClient: {
    write: (id: string, data: string) => {
      writes.push({ id, data });
    },
  },
}));

vi.mock('$lib/server/prompt-capture.js', () => ({
  capturePromptInput,
}));

const { POST } = await import('../src/routes/api/sessions/[id]/terminal/input/+server.js');

let dataDir = '';
let originalDataDir: string | undefined;

function inputEvent(id: string, body: unknown, locals: Record<string, unknown> = {}) {
  return {
    params: { id },
    request: new Request(`https://ant.test/api/sessions/${id}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    locals,
  } as any;
}

function createSession(id: string, type = 'terminal') {
  queries.createSession(id, id, type, 'forever', null, null, '{}');
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

describe('/api/sessions/:id/terminal/input', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-terminal-input-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    getDb();
    writes.length = 0;
    capturePromptInput.mockReset();
    capturePromptInput.mockReturnValue({ id: 'event-1', kind: 'prompt' });
    createSession('terminal');
    createSession('chat', 'chat');
    createSession('archived');
    queries.updateSession(null, null, 1, null, 'archived');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  it('writes valid terminal input and captures prompt metadata', async () => {
    const response = await POST(inputEvent('terminal', { data: 'hello terminal' }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, event: { id: 'event-1', kind: 'prompt' } });
    expect(writes).toEqual([{ id: 'terminal', data: 'hello terminal' }]);
    expect(capturePromptInput).toHaveBeenCalledWith('terminal', 'hello terminal', {
      captureSource: 'api_terminal_input',
      transport: 'rest',
    });
  });

  it('rejects malformed JSON and invalid data without PTY side effects', async () => {
    const malformed = await POST(inputEvent('terminal', '{'));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toEqual({ ok: false, error: 'Invalid JSON' });

    const missing = await POST(inputEvent('terminal', {}));
    expect(missing.status).toBe(400);
    expect(await missing.json()).toEqual({ ok: false, error: 'data must be a non-empty string' });

    const wrongType = await POST(inputEvent('terminal', { data: 123 }));
    expect(wrongType.status).toBe(400);
    expect(await wrongType.json()).toEqual({ ok: false, error: 'data must be a non-empty string' });

    expect(writes).toEqual([]);
    expect(capturePromptInput).not.toHaveBeenCalled();
  });

  it('rejects missing, non-terminal, and inactive sessions without PTY side effects', async () => {
    const missing = await POST(inputEvent('missing', { data: 'hello' }));
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({ ok: false, error: 'terminal session not found' });

    const chat = await POST(inputEvent('chat', { data: 'hello' }));
    expect(chat.status).toBe(404);
    expect(await chat.json()).toEqual({ ok: false, error: 'terminal session not found' });

    const archived = await POST(inputEvent('archived', { data: 'hello' }));
    expect(archived.status).toBe(410);
    expect(await archived.json()).toEqual({ ok: false, error: 'terminal session is inactive' });

    expect(writes).toEqual([]);
    expect(capturePromptInput).not.toHaveBeenCalled();
  });

  it('rejects room-scoped callers before writing PTY input', async () => {
    await expectHttpError(
      () => POST(inputEvent('terminal', { data: 'hello' }, { roomScope: { roomId: 'terminal', kind: 'cli' } })),
      403,
    );

    expect(writes).toEqual([]);
    expect(capturePromptInput).not.toHaveBeenCalled();
  });
});
