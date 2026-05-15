/**
 * Unit tests for the `ant sessions <id> digest` CLI subverb wrapper.
 *
 * Wraps GET /api/sessions/:id/digest. Outputs human text by default,
 * JSON with --json. Backs M2.3 in DELIVERY-PLAN.md (manifest entry
 * `sessions-digest` flips from "needs-wrapper" to "available").
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sessions } from '../cli/commands/sessions';

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalErr = console.error;

let stdout: string[] = [];
let stderr: string[] = [];

beforeEach(() => {
  stdout = [];
  stderr = [];
  console.log = (...parts: unknown[]) => { stdout.push(parts.map(String).join(' ')); };
  console.error = (...parts: unknown[]) => { stderr.push(parts.map(String).join(' ')); };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalErr;
  globalThis.fetch = originalFetch;
});

function stubFetch(fetchMock: typeof fetch) {
  globalThis.fetch = fetchMock;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

const ctx = { serverUrl: 'http://ant.test', apiKey: '', json: false };

describe('ant sessions <id> digest', () => {
  it('prints "no messages yet" when the digest has zero messages', async () => {
    stubFetch(async () => jsonResponse({
      messageCount: 0, participantCount: 0, durationMinutes: 0,
      messagesPerHour: 0, participants: [], keyTerms: [],
      firstMessage: null, lastMessage: null
    }));
    await sessions(['digest', 'sess-empty'], {}, ctx);
    expect(stdout.join('\n')).toMatch(/Session sess-empty: no messages yet/);
  });

  it('prints human-readable digest with counts + participants + key terms', async () => {
    stubFetch(async () => jsonResponse({
      messageCount: 42,
      participantCount: 3,
      durationMinutes: 90,
      messagesPerHour: 28,
      participants: [
        { id: '@you', count: 20 },
        { id: '@codex', count: 15 },
        { id: '@kimi', count: 7 }
      ],
      keyTerms: [
        { term: 'persistence', count: 12 },
        { term: 'gate', count: 9 }
      ],
      firstMessage: '2026-05-14T05:00:00Z',
      lastMessage: '2026-05-14T06:30:00Z'
    }));
    await sessions(['digest', 'sess-busy'], {}, ctx);
    const out = stdout.join('\n');
    expect(out).toMatch(/Session sess-busy digest/);
    expect(out).toMatch(/Messages:\s+42/);
    expect(out).toMatch(/Participants:\s+3/);
    expect(out).toMatch(/Duration \(min\):\s+90/);
    expect(out).toMatch(/Messages\/hour:\s+28/);
    expect(out).toMatch(/@you \(20\)/);
    expect(out).toMatch(/@codex \(15\)/);
    expect(out).toMatch(/persistence \(12\)/);
    expect(out).toMatch(/First message:\s+2026-05-14T05:00:00Z/);
    expect(out).toMatch(/Last message:\s+2026-05-14T06:30:00Z/);
  });

  it('emits JSON when --json flag is set on ctx', async () => {
    const payload = {
      messageCount: 5, participantCount: 1, durationMinutes: 2,
      messagesPerHour: 150, participants: [{ id: '@you', count: 5 }],
      keyTerms: [{ term: 'json', count: 3 }],
      firstMessage: '2026-05-14T05:00:00Z',
      lastMessage: '2026-05-14T05:02:00Z'
    };
    stubFetch(async () => jsonResponse(payload));
    await sessions(['digest', 'sess-json'], {}, { ...ctx, json: true });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toEqual(payload);
  });

  it('caps top participants list at 5 entries even when more are returned', async () => {
    stubFetch(async () => jsonResponse({
      messageCount: 20, participantCount: 7, durationMinutes: 10,
      messagesPerHour: 120,
      participants: [
        { id: '@a', count: 9 }, { id: '@b', count: 4 }, { id: '@c', count: 3 },
        { id: '@d', count: 2 }, { id: '@e', count: 1 },
        { id: '@f', count: 1 }, { id: '@g', count: 0 }
      ],
      keyTerms: [], firstMessage: null, lastMessage: null
    }));
    await sessions(['digest', 'sess-many'], {}, ctx);
    const out = stdout.join('\n');
    expect(out).toMatch(/@a \(9\)/);
    expect(out).toMatch(/@e \(1\)/);
    expect(out).not.toMatch(/@f \(/);
    expect(out).not.toMatch(/@g \(/);
  });

  it('errors with usage hint when id missing', async () => {
    stubFetch(async () => { throw new Error('fetch should not be called'); });
    await sessions(['digest'], {}, ctx);
    expect(stderr.join('\n')).toMatch(/Usage: ant sessions digest/);
  });
});
