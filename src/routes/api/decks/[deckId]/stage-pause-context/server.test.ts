/**
 * Tests for POST /api/decks/[deckId]/stage-pause-context (γ2).
 *
 * Mirrors the shape of stage-focus server.test.ts. Verifies:
 * - 404 when deck does not exist
 * - 400 when body invalid / slideIndex outside range / slideId mismatch
 * - 201 + event persisted on happy path
 * - estimated_char_offset preserved with prefix (codex schema review)
 * - paused_at_ms clamped to server time when drift > 60s (anti-spoof)
 * - spoken_window truncated to MAX_SPOKEN_WINDOW_CHARS
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { resetDeckStoreForTests, createDeck } from '$lib/server/deckStore';
import { resetChatRoomStoreForTests, createChatRoom } from '$lib/server/chatRoomStore';
import { resetPlanModeStoreForTests } from '$lib/server/planModeStore';

let tmpDir: string;
const prevDbPath = process.env.ANT_FRESH_DB_PATH;
const prevAdminToken = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'test-admin-token-stage-pause';

function setupRoom(): string {
  const room = createChatRoom({ name: 'pause-test', whoCreatedIt: '@you' });
  return room.id;
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-stage-pause-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetDeckStoreForTests();
  resetPlanModeStoreForTests();
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDbPath;
  if (prevAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = prevAdminToken;
});

function makeRequest(body: unknown, opts: { withAuth?: boolean } = { withAuth: true }): Request {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.withAuth) headers['authorization'] = `Bearer ${ADMIN_TOKEN}`;
  return new Request('http://test/api/decks/d/stage-pause-context', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
}

async function callPost(deckId: string, body: unknown, opts?: { withAuth?: boolean }): Promise<Response> {
  // Cast through unknown to satisfy SvelteKit's RequestEvent type without
  // building the full handler context — POST only reads params + request.
  return await (POST as unknown as (event: { params: { deckId: string }; request: Request }) => Promise<Response>)({
    params: { deckId },
    request: makeRequest(body, opts ?? { withAuth: true })
  });
}

describe('POST /api/decks/[deckId]/stage-pause-context', () => {
  it('404 when deck does not exist', async () => {
    await expect(callPost('does-not-exist', { slideIndex: 0 })).rejects.toMatchObject({ status: 404 });
  });

  it('400 when body is not JSON', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [{ id: 's1', title: 'one', content: 'first' }]
    });
    const req = new Request('http://test/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': `Bearer ${ADMIN_TOKEN}` },
      body: 'not-json'
    });
    await expect(
      (POST as unknown as (event: { params: { deckId: string }; request: Request }) => Promise<Response>)({
        params: { deckId: deck.id },
        request: req
      })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('400 when slideIndex is not an integer', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [{ id: 's1', title: 'one', content: 'first' }]
    });
    await expect(callPost(deck.id, { slideIndex: 'one' })).rejects.toMatchObject({ status: 400 });
  });

  it('400 when slideIndex is outside the deck', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [{ id: 's1', title: 'one', content: 'first' }]
    });
    await expect(callPost(deck.id, { slideIndex: 99 })).rejects.toMatchObject({ status: 400 });
  });

  it('400 when slideId does not match slideIndex', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [
        { id: 's1', title: 'one', content: 'first' },
        { id: 's2', title: 'two', content: 'second' }
      ]
    });
    await expect(callPost(deck.id, { slideIndex: 0, slideId: 's2' })).rejects.toMatchObject({ status: 400 });
  });

  it('201 + persists evidence with estimated_ prefix preserved', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [{ id: 's1', title: 'one', content: 'first slide content' }]
    });
    const res = await callPost(deck.id, {
      slideIndex: 0,
      slideId: 's1',
      narrationSource: 'content',
      pausedAtMs: Date.now(),
      estimatedCharOffset: 42,
      spokenWindow: 'we do X because of Y'
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pause_context.kind).toBe('stage_pause_context');
    expect(body.pause_context.estimated_char_offset).toBe(42);
    expect(body.pause_context.spoken_window).toBe('we do X because of Y');
    expect(body.pause_context.deck_id).toBe(deck.id);

    // Verify event reached the plan event store. listAllEvidence flattens
    // task evidence, not plan_event evidence — so we query plan_events
    // directly via getIdentityDb to confirm persistence.
    const { getIdentityDb } = await import('$lib/server/db');
    const rows = getIdentityDb()
      .prepare(`SELECT id, evidence_json FROM plan_events WHERE plan_id = ?`)
      .all(`stage-${deck.id}`) as Array<{ id: string; evidence_json: string }>;
    expect(rows.length).toBe(1);
    const ev = JSON.parse(rows[0].evidence_json);
    expect(ev[0].kind).toBe('stage_pause_context');
    expect(ev[0].ref).toContain(`stage:${deck.id}:pause:s1:`);
    expect(ev[0].estimated_char_offset).toBe(42);
  });

  it('clamps paused_at_ms to server time when drift > 60s', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [{ id: 's1', title: 'one', content: 'first' }]
    });
    const farFuture = Date.now() + 10 * 60 * 1000; // 10 minutes ahead
    const before = Date.now();
    const res = await callPost(deck.id, {
      slideIndex: 0,
      pausedAtMs: farFuture
    });
    const after = Date.now();
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pause_context.paused_at_ms).toBeGreaterThanOrEqual(before);
    expect(body.pause_context.paused_at_ms).toBeLessThanOrEqual(after);
  });

  it('truncates oversized spoken_window to 500 chars', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [{ id: 's1', title: 'one', content: 'first' }]
    });
    const long = 'a'.repeat(2000);
    const res = await callPost(deck.id, {
      slideIndex: 0,
      spokenWindow: long
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pause_context.spoken_window.length).toBe(500);
  });

  it('falls back to narration_source=content for unknown values', async () => {
    const deck = createDeck({
      roomId: setupRoom(),
      title: 't',
      slides: [{ id: 's1', title: 'one', content: 'first' }]
    });
    const res = await callPost(deck.id, {
      slideIndex: 0,
      narrationSource: 'something-weird'
    });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.pause_context.narration_source).toBe('content');
  });
});
