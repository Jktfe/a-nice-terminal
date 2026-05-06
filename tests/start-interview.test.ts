// M2 #1 — start-interview pure helper.
// Uses a fake queries object so we don't need a real db; mirrors the DI shape
// in src/lib/server/interview/publish-summary.ts and matches the testable-
// singleton convention from cli/lib/config and src/lib/server/db.
import { describe, expect, it } from 'vitest';
import {
  startInterview,
  type StartInterviewQueries,
} from '../src/lib/server/interview/start-interview.js';

interface FakeSession {
  id: string;
  type: string;
  name?: string;
  display_name?: string;
  handle?: string;
  linked_chat_id?: string | null;
}

function makeFakeQueries(seed: FakeSession[]): {
  q: StartInterviewQueries;
  created: Array<{ id: string; name: string; type: string; meta: string }>;
  links: Array<{ sessionId: string; chatId: string }>;
  store: Map<string, FakeSession>;
} {
  const store = new Map<string, FakeSession>(seed.map((s) => [s.id, { ...s }]));
  const created: Array<{ id: string; name: string; type: string; meta: string }> = [];
  const links: Array<{ sessionId: string; chatId: string }> = [];
  return {
    store,
    created,
    links,
    q: {
      getSession: (id: string) => store.get(id),
      createSession: (id, name, type, _ttl, _ws, _root, meta) => {
        store.set(id, { id, type, name } as FakeSession);
        created.push({ id, name, type, meta });
      },
      setLinkedChat: (sessionId, chatId) => {
        const existing = store.get(sessionId);
        if (existing) existing.linked_chat_id = chatId;
        links.push({ sessionId, chatId });
      },
    },
  };
}

describe('startInterview', () => {
  it('creates a new linked chat when the target has no linked_chat_id', () => {
    const { q, created, links, store } = makeFakeQueries([
      { id: 't-james', type: 'terminal', display_name: 'James terminal' },
    ]);
    const result = startInterview(q, 't-james', {}, () => 'chat-fixed-id', () => 1730000000000);
    expect(result).toEqual({
      ok: true,
      created: true,
      linked_chat_id: 'chat-fixed-id',
      target_session_id: 't-james',
      chat_name: 'Interview: James terminal',
    });
    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({ id: 'chat-fixed-id', type: 'chat', name: 'Interview: James terminal' });
    const meta = JSON.parse(created[0].meta);
    expect(meta).toMatchObject({ interview: true, started_at_ms: 1730000000000 });
    expect(links).toEqual([{ sessionId: 't-james', chatId: 'chat-fixed-id' }]);
    expect(store.get('t-james')?.linked_chat_id).toBe('chat-fixed-id');
  });

  it('returns the existing linked chat when one already exists (focus, not create)', () => {
    const { q, created, links } = makeFakeQueries([
      { id: 't-james', type: 'terminal', linked_chat_id: 'chat-existing' },
    ]);
    const result = startInterview(q, 't-james');
    expect(result).toEqual({
      ok: true,
      created: false,
      linked_chat_id: 'chat-existing',
      target_session_id: 't-james',
    });
    expect(created).toHaveLength(0);
    expect(links).toHaveLength(0);
  });

  it('returns target_not_found when the target session does not exist', () => {
    const { q } = makeFakeQueries([]);
    const result = startInterview(q, 'missing');
    expect(result).toEqual({ ok: false, error: 'target_not_found' });
  });

  it('returns invalid_target_type for non-terminal/chat/agent sessions', () => {
    const { q } = makeFakeQueries([
      { id: 't-weird', type: 'workspace' },
    ]);
    const result = startInterview(q, 't-weird');
    expect(result).toEqual({ ok: false, error: 'invalid_target_type' });
  });

  it('falls back to handle then "agent" for the chat name when display_name and name are absent', () => {
    const { q, created } = makeFakeQueries([
      { id: 't-h', type: 'terminal', handle: '@codex' },
    ]);
    startInterview(q, 't-h', {}, () => 'c-1');
    expect(created[0].name).toBe('Interview: @codex');
  });

  it('captures origin_room_id and caller_handle in the chat meta blob', () => {
    const { q, created } = makeFakeQueries([
      { id: 't-james', type: 'terminal', name: 'James' },
    ]);
    startInterview(q, 't-james', { origin_room_id: 'room-x', caller_handle: '@james' }, () => 'c-2', () => 42);
    const meta = JSON.parse(created[0].meta);
    expect(meta).toEqual({
      interview: true,
      origin_room_id: 'room-x',
      caller_handle: '@james',
      started_at_ms: 42,
    });
  });
});
