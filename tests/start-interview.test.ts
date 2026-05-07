// startInterview pure helper — multi-participant redesign (2026-05-07).
//
// Behavioural contract changes from the prior 1:1-pairing version:
//   - No longer sets linked_chat_id on the target.
//   - No longer focuses an existing linked chat — every call creates fresh.
//   - No recursion error; nested interviews are allowed.
//   - Chat name de-dupes the "Interview: " prefix.
//   - Optional seed_message_id / seed_text post a system message into the new chat.
//   - participants_invited contains the target plus opts.participants (deduped, order preserved).
import { describe, expect, it } from 'vitest';
import {
  startInterview,
  type StartInterviewQueries,
  type CreateMessageInput,
} from '../src/lib/server/interview/start-interview.js';

interface FakeSession {
  id: string;
  type: string;
  name?: string;
  display_name?: string;
  handle?: string;
  linked_chat_id?: string | null;
  meta?: string | null;
}

interface FakeMessage {
  id: string;
  session_id: string;
  role?: string;
  content?: string;
  sender_id?: string | null;
}

function makeFakeQueries(seedSessions: FakeSession[], seedMessages: FakeMessage[] = []): {
  q: StartInterviewQueries;
  created: Array<{ id: string; name: string; type: string; meta: string }>;
  messages: CreateMessageInput[];
  store: Map<string, FakeSession>;
} {
  const store = new Map<string, FakeSession>(seedSessions.map((s) => [s.id, { ...s }]));
  const messageStore = new Map<string, FakeMessage>(seedMessages.map((m) => [m.id, { ...m }]));
  const created: Array<{ id: string; name: string; type: string; meta: string }> = [];
  const messages: CreateMessageInput[] = [];
  return {
    store,
    created,
    messages,
    q: {
      getSession: (id: string) => store.get(id),
      createSession: (id, name, type, _ttl, _ws, _root, meta) => {
        store.set(id, { id, type, name } as FakeSession);
        created.push({ id, name, type, meta });
      },
      getMessage: (id: string) => messageStore.get(id),
      createMessage: (input: CreateMessageInput) => {
        messages.push(input);
      },
    },
  };
}

let nextId = 0;
function counterIdGen(): string {
  return `id-${++nextId}`;
}

describe('startInterview (multi-participant redesign)', () => {
  it('creates a fresh chat without setting linked_chat_id', () => {
    nextId = 0;
    const { q, created, store } = makeFakeQueries([
      { id: 't-james', type: 'terminal', display_name: 'James terminal' },
    ]);
    const result = startInterview(q, 't-james', {}, counterIdGen, () => 1730000000000);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chat_id).toBe('id-1');
    expect(result.chat_name).toBe('Interview: James terminal');
    expect(result.participants_invited).toEqual(['t-james']);
    expect(result.seed_posted).toBe(false);
    expect(created).toHaveLength(1);
    // Critical invariant: the target's linked_chat_id is NOT touched.
    expect(store.get('t-james')?.linked_chat_id).toBeUndefined();
  });

  it('always creates fresh — never returns an existing chat', () => {
    nextId = 0;
    // Even if the target already has a linked_chat_id from some other system,
    // the new helper ignores it and creates a brand new chat each call.
    const { q, created } = makeFakeQueries([
      { id: 't-james', type: 'terminal', linked_chat_id: 'chat-existing' },
    ]);
    const result = startInterview(q, 't-james', {}, counterIdGen, () => 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.chat_id).toBe('id-1');
    expect(result.chat_id).not.toBe('chat-existing');
    expect(created).toHaveLength(1);
  });

  it('returns target_not_found when the target session does not exist', () => {
    const { q } = makeFakeQueries([]);
    const result = startInterview(q, 'missing');
    expect(result).toEqual({ ok: false, error: 'target_not_found' });
  });

  it('returns invalid_target_type for non-terminal/chat/agent sessions', () => {
    const { q } = makeFakeQueries([{ id: 't-weird', type: 'workspace' }]);
    const result = startInterview(q, 't-weird');
    expect(result).toEqual({ ok: false, error: 'invalid_target_type' });
  });

  it('falls back to handle then "agent" for the chat name', () => {
    nextId = 0;
    const { q, created } = makeFakeQueries([{ id: 't-h', type: 'terminal', handle: '@codex' }]);
    startInterview(q, 't-h', {}, counterIdGen);
    expect(created[0].name).toBe('Interview: @codex');
  });

  it('does NOT double-prefix when target name already starts with "Interview: "', () => {
    // Was the "Interview: Interview: Interview: ANTchat" disaster — can't happen now.
    nextId = 0;
    const { q, created } = makeFakeQueries([
      { id: 'chat-x', type: 'chat', name: 'Interview: ANTchat' },
    ]);
    const result = startInterview(q, 'chat-x', {}, counterIdGen);
    expect(result.ok).toBe(true);
    expect(created[0].name).toBe('Interview: ANTchat');
  });

  it('allows recursion — interview about an interview is fine', () => {
    nextId = 0;
    const { q, created } = makeFakeQueries([
      {
        id: 'chat-existing-interview',
        type: 'chat',
        name: 'Interview: James',
        meta: JSON.stringify({ interview: true, origin_room_id: 'room-x' }),
      },
    ]);
    const result = startInterview(q, 'chat-existing-interview', {}, counterIdGen);
    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
    expect(created[0].name).toBe('Interview: James');  // prefix not doubled
  });

  it('captures origin_room_id and caller_handle in the chat meta', () => {
    nextId = 0;
    const { q, created } = makeFakeQueries([
      { id: 't-james', type: 'terminal', name: 'James' },
    ]);
    startInterview(
      q,
      't-james',
      { origin_room_id: 'room-x', caller_handle: '@james' },
      counterIdGen,
      () => 42,
    );
    const meta = JSON.parse(created[0].meta);
    expect(meta).toMatchObject({
      interview: true,
      origin_room_id: 'room-x',
      caller_handle: '@james',
      started_at_ms: 42,
      participants_seed: ['t-james'],
    });
  });

  it('records additional participants in meta + result, deduping the target', () => {
    nextId = 0;
    const { q, created } = makeFakeQueries([
      { id: 't-james', type: 'terminal' },
      { id: 't-vera', type: 'terminal' },
      { id: 't-house', type: 'terminal' },
    ]);
    const result = startInterview(
      q,
      't-james',
      { participants: ['t-vera', 't-house', 't-james'] },  // target re-listed
      counterIdGen,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.participants_invited).toEqual(['t-james', 't-vera', 't-house']);
    const meta = JSON.parse(created[0].meta);
    expect(meta.participants_seed).toEqual(['t-james', 't-vera', 't-house']);
  });

  it('copies a seed message into the new chat as a system message', () => {
    nextId = 0;
    const { q, created, messages } = makeFakeQueries(
      [{ id: 't-james', type: 'terminal' }],
      [{ id: 'm-1', session_id: 'origin-room', role: 'assistant', content: 'Topics: X, Y, Z', sender_id: '@codex' }],
    );
    const result = startInterview(q, 't-james', { seed_message_id: 'm-1' }, counterIdGen);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed_posted).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      sessionId: created[0].id,
      role: 'system',
      content: 'Topics: X, Y, Z',
    });
    const seedMeta = JSON.parse(messages[0].meta!);
    expect(seedMeta.seed_from).toEqual({
      message_id: 'm-1',
      room_id: 'origin-room',
      sender_id: '@codex',
    });
  });

  it('records seed_message_id in chat meta even when getMessage is unavailable', () => {
    nextId = 0;
    // queries without getMessage/createMessage — helper should still record
    // the intent in meta, just skip the actual copy.
    const store = new Map<string, FakeSession>([
      ['t-james', { id: 't-james', type: 'terminal' }],
    ]);
    const created: Array<{ id: string; name: string; type: string; meta: string }> = [];
    const q: StartInterviewQueries = {
      getSession: (id) => store.get(id),
      createSession: (id, name, type, _ttl, _ws, _root, meta) => {
        store.set(id, { id, type, name } as FakeSession);
        created.push({ id, name, type, meta });
      },
    };
    const result = startInterview(q, 't-james', { seed_message_id: 'm-1' }, counterIdGen);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed_posted).toBe(false);
    const meta = JSON.parse(created[0].meta);
    expect(meta.seed_message_id).toBe('m-1');
  });

  it('uses seed_text as inline seed when seed_message_id is not provided', () => {
    nextId = 0;
    const { q, created, messages } = makeFakeQueries([{ id: 't-james', type: 'terminal' }]);
    const result = startInterview(
      q,
      't-james',
      { seed_text: 'Talk to me about the outstanding points' },
      counterIdGen,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed_posted).toBe(true);
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Talk to me about the outstanding points');
    const meta = JSON.parse(created[0].meta);
    expect(meta.seed_text).toBe('Talk to me about the outstanding points');
  });

  it('seed_message_id wins over seed_text when both are provided', () => {
    nextId = 0;
    const { q, messages } = makeFakeQueries(
      [{ id: 't-james', type: 'terminal' }],
      [{ id: 'm-1', session_id: 'origin-room', content: 'Message wins' }],
    );
    startInterview(
      q,
      't-james',
      { seed_message_id: 'm-1', seed_text: 'Inline loses' },
      counterIdGen,
    );
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toBe('Message wins');
  });

  it('returns seed_posted=false when the seed message has no content', () => {
    nextId = 0;
    const { q, messages } = makeFakeQueries(
      [{ id: 't-james', type: 'terminal' }],
      [{ id: 'm-empty', session_id: 'origin-room', content: '' }],
    );
    const result = startInterview(q, 't-james', { seed_message_id: 'm-empty' }, counterIdGen);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.seed_posted).toBe(false);
    expect(messages).toHaveLength(0);
  });

  it('tolerates unparseable session meta on the target', () => {
    nextId = 0;
    const { q, created } = makeFakeQueries([
      { id: 'chat-broken', type: 'chat', name: 'broken', meta: '{not-json' },
    ]);
    const result = startInterview(q, 'chat-broken', {}, counterIdGen);
    expect(result.ok).toBe(true);
    expect(created).toHaveLength(1);
  });
});
