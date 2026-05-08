// m2 of chat-break-context-window-2026-05-08:
// the right-rail toggle PATCHes /api/sessions/:id with `long_memory` and
// expects the column to flip both ways. The helper that reads the column
// (roomLongMemoryEnabled) is what bounds agent context — covered by
// tests/chat-context.test.ts. This test only owns the PATCH wiring.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { _resetForTest, queries } from '../src/lib/server/db.js';
import { roomLongMemoryEnabled } from '../src/lib/server/chat-context.js';
import { PATCH as patchSession } from '../src/routes/api/sessions/[id]/+server.js';

const ROOM_ID = 'long-memory-patch-room';

let dataDir = '';
let originalDataDir: string | undefined;

describe('PATCH /api/sessions/:id — long_memory', () => {
  beforeEach(() => {
    originalDataDir = process.env.ANT_DATA_DIR;
    dataDir = mkdtempSync(join(tmpdir(), 'ant-long-memory-patch-'));
    process.env.ANT_DATA_DIR = dataDir;
    _resetForTest();
    queries.createSession(ROOM_ID, 'Long Memory Patch Room', 'chat', '15m', null, null, '{}');
  });

  afterEach(() => {
    _resetForTest();
    if (originalDataDir === undefined) delete process.env.ANT_DATA_DIR;
    else process.env.ANT_DATA_DIR = originalDataDir;
    rmSync(dataDir, { recursive: true, force: true });
  });

  function patchEvent(body: Record<string, unknown>) {
    return {
      params: { id: ROOM_ID },
      request: new Request(`https://ant.test/api/sessions/${ROOM_ID}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      }),
      // assertNotRoomScoped reads `locals.roomScope`. Admin contexts have
      // none — the default for these tests.
      locals: {},
    } as any;
  }

  it('flips long_memory on, then off, persisting via roomLongMemoryEnabled', async () => {
    expect(roomLongMemoryEnabled(ROOM_ID)).toBe(false);

    const onRes = await patchSession(patchEvent({ long_memory: true }));
    expect(onRes.status).toBe(200);
    expect(roomLongMemoryEnabled(ROOM_ID)).toBe(true);

    const offRes = await patchSession(patchEvent({ long_memory: false }));
    expect(offRes.status).toBe(200);
    expect(roomLongMemoryEnabled(ROOM_ID)).toBe(false);
  });

  it('ignores PATCH bodies that do not mention long_memory', async () => {
    queries.setLongMemory(ROOM_ID, true);
    const res = await patchSession(patchEvent({ name: 'Long Memory Patch Room (renamed)' }));
    expect(res.status).toBe(200);
    expect(roomLongMemoryEnabled(ROOM_ID)).toBe(true);
  });
});
