// Task #27 — bounded message-list pagination.
//
// Before this fix, GET /api/sessions/:id/messages silently ignored the
// `?limit=` query param when no `since`/`before` cursor was supplied, returning
// every message in the room on every page load. The fix introduces
// `getLatestMessages(sessionId, limit)` and bounds the no-cursor path when
// `?limit=` is explicitly provided. The unbounded path is preserved for
// backward compat callers that pass nothing.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import { GET as getMessages } from '../src/routes/api/sessions/[id]/messages/+server.js';

const SESSION_ID = 'test-messages-pagination-room';

function cleanup() {
  const db = getDb();
  db.prepare('DELETE FROM messages WHERE session_id = ?').run(SESSION_ID);
  db.prepare('DELETE FROM sessions WHERE id = ?').run(SESSION_ID);
}

async function callGet(query: string): Promise<{ messages: any[] }> {
  const url = new URL(`https://ant.example.test/api/sessions/${SESSION_ID}/messages${query}`);
  const event: any = { params: { id: SESSION_ID }, url };
  const res = getMessages(event);
  return await (res as Response).json();
}

function seed(count: number) {
  // Bun's better-sqlite3 shim stores created_at as TEXT via DEFAULT
  // CURRENT_TIMESTAMP at second resolution, so consecutive inserts can collide.
  // Force ms-resolution timestamps so the cursor tests have stable ordering.
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO messages (id, session_id, role, content, format, status, msg_type, created_at)
     VALUES (?, ?, 'user', ?, 'text', 'complete', 'message', ?)`,
  );
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const ts = new Date(now - (count - i) * 1000).toISOString();
    insert.run(`msg-${i.toString().padStart(4, '0')}`, SESSION_ID, `body ${i}`, ts);
  }
}

describe('GET /api/sessions/:id/messages — bounded latest-N', () => {
  beforeEach(() => {
    cleanup();
    queries.createSession(SESSION_ID, 'Pagination Test Room', 'chat', '15m', null, null, '{}');
  });
  afterEach(cleanup);

  it('returns the latest N messages in ASC order when ?limit= is provided', async () => {
    seed(120);
    const data = await callGet('?limit=50');
    expect(data.messages).toHaveLength(50);
    // Latest 50 are msg-0070 .. msg-0119
    expect(data.messages[0].id).toBe('msg-0070');
    expect(data.messages[49].id).toBe('msg-0119');
  });

  it('preserves backward compat — no ?limit= returns the full unbounded history', async () => {
    seed(120);
    const data = await callGet('');
    expect(data.messages).toHaveLength(120);
    expect(data.messages[0].id).toBe('msg-0000');
    expect(data.messages[119].id).toBe('msg-0119');
  });

  it('?before=<created_at>&limit=N returns the N messages immediately before the cursor', async () => {
    seed(120);
    // Grab the latest 50, then page back from the oldest of that page.
    const first = await callGet('?limit=50');
    const oldestOfFirstPage = first.messages[0];
    const second = await callGet(
      `?before=${encodeURIComponent(oldestOfFirstPage.created_at)}&limit=50`,
    );
    expect(second.messages).toHaveLength(50);
    // Should be msg-0020 .. msg-0069 — the 50 immediately before msg-0070.
    expect(second.messages[0].id).toBe('msg-0020');
    expect(second.messages[49].id).toBe('msg-0069');
  });

  it('returns fewer than ?limit when the older history is exhausted — signals end-of-history', async () => {
    seed(30);
    const first = await callGet('?limit=50');
    expect(first.messages).toHaveLength(30);
    // No more older messages — paging back returns 0 items.
    const second = await callGet(
      `?before=${encodeURIComponent(first.messages[0].created_at)}&limit=50`,
    );
    expect(second.messages).toHaveLength(0);
  });
});
