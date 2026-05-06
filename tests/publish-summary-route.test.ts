// M2 #2 — publishSummaryFromLinkedChat helper test.
// Pure-function level — fakes the queries object so we can assert
// origin-room resolution, validation errors, and message insertion.
import { describe, expect, it } from 'vitest';
import { publishSummaryFromLinkedChat } from '../src/lib/server/interview/publish-summary-route.js';
import { PUBLISH_SUMMARY_VERSION } from '../src/lib/server/interview/publish-summary.js';

interface FakeMessage {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  format: string;
  status: string;
  senderId: string | null;
  msgType: string;
  meta: string;
}

function makeFakes(seedSessions: Array<{ id: string; type: string; meta?: string }> = []) {
  const sessions = new Map(seedSessions.map((s) => [s.id, { ...s, meta: s.meta ?? '{}' }] as const));
  const messages: FakeMessage[] = [];
  let counter = 0;
  const q = {
    getSession: (id: string) => sessions.get(id) ?? null,
    createMessage: (
      id: string,
      sessionId: string,
      role: string,
      content: string,
      format: string,
      status: string,
      senderId: string | null,
      _target: string | null,
      _replyTo: string | null,
      msgType: string,
      meta: string,
    ) => {
      messages.push({ id, sessionId, role, content, format, status, senderId, msgType, meta });
    },
  };
  const idGen = () => `m-${++counter}`;
  return { q, messages, sessions, idGen };
}

describe('publishSummaryFromLinkedChat', () => {
  it('returns chat_not_found when the linked chat id is unknown', () => {
    const { q } = makeFakes();
    const result = publishSummaryFromLinkedChat(q, 'missing', { title: 'X' });
    expect(result).toEqual({ ok: false, error: 'chat_not_found' });
  });

  it('returns invalid_chat_type when the session is not a chat', () => {
    const { q } = makeFakes([{ id: 'lc-1', type: 'terminal', meta: '{}' }]);
    const result = publishSummaryFromLinkedChat(q, 'lc-1', { title: 'X' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_chat_type');
    expect(result.reason).toBe('terminal');
  });

  it('returns no_origin_room when chat meta lacks origin_room_id', () => {
    const { q } = makeFakes([{ id: 'lc-1', type: 'chat', meta: '{"interview":true}' }]);
    const result = publishSummaryFromLinkedChat(q, 'lc-1', { title: 'X' });
    expect(result).toEqual({ ok: false, error: 'no_origin_room' });
  });

  it('returns invalid_input when title is empty', () => {
    const { q } = makeFakes([
      { id: 'lc-1', type: 'chat', meta: '{"origin_room_id":"r-1"}' },
    ]);
    const result = publishSummaryFromLinkedChat(q, 'lc-1', { title: '   ' });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe('invalid_input');
  });

  it('builds the summary and posts a markdown message into the origin room', () => {
    const { q, messages, idGen } = makeFakes([
      { id: 'lc-1', type: 'chat', meta: '{"origin_room_id":"r-1","interview":true}' },
    ]);
    const result = publishSummaryFromLinkedChat(
      q,
      'lc-1',
      {
        title: 'Auth model walkthrough',
        findings: ['scrypt for local', '  ', 'bearer for shared'],
        decisions: ['drop session-token storage'],
        asks: [],
        actions: ['file ticket'],
        sources: [{ message_id: 'msg-7', excerpt: 'we got burned' }],
        authoredBy: '@jwpk',
      },
      { idGen, nowMs: () => 1_700_000_000_000 },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.message_id).toBe('m-1');
    expect(result.origin_room_id).toBe('r-1');
    expect(result.linked_chat_id).toBe('lc-1');
    expect(result.summary.schema_version).toBe(PUBLISH_SUMMARY_VERSION);
    expect(result.summary.findings).toEqual(['scrypt for local', 'bearer for shared']);
    expect(result.summary.generated_at_ms).toBe(1_700_000_000_000);

    expect(messages).toHaveLength(1);
    const m = messages[0];
    expect(m.id).toBe('m-1');
    expect(m.sessionId).toBe('r-1');
    expect(m.role).toBe('system');
    expect(m.format).toBe('markdown');
    expect(m.msgType).toBe('publish_summary');
    expect(m.senderId).toBe('@jwpk');
    expect(m.content).toContain('## Auth model walkthrough');
    expect(m.content).toContain('### Findings');
    expect(m.content).toContain('- scrypt for local');
    expect(m.content).toContain('Full transcript: /chat/lc-1');

    const meta = JSON.parse(m.meta);
    expect(meta.source).toBe('publish_summary');
    expect(meta.linked_chat_id).toBe('lc-1');
    expect(meta.schema_version).toBe(PUBLISH_SUMMARY_VERSION);
    const inner = JSON.parse(meta.summary);
    expect(inner.title).toBe('Auth model walkthrough');
  });

  it('honours an explicit transcript_url override', () => {
    const { q, messages } = makeFakes([
      { id: 'lc-1', type: 'chat', meta: '{"origin_room_id":"r-1"}' },
    ]);
    const result = publishSummaryFromLinkedChat(
      q,
      'lc-1',
      { title: 'X', transcriptUrl: 'https://ant.local/transcripts/lc-1' },
      { nowMs: () => 1 },
    );
    expect(result.ok).toBe(true);
    expect(messages[0].content).toContain('Full transcript: https://ant.local/transcripts/lc-1');
  });

  it('omits empty section headers in the rendered markdown', () => {
    const { q, messages } = makeFakes([
      { id: 'lc-1', type: 'chat', meta: '{"origin_room_id":"r-1"}' },
    ]);
    const result = publishSummaryFromLinkedChat(
      q,
      'lc-1',
      { title: 'Sparse', findings: ['only this'] },
      { nowMs: () => 1 },
    );
    expect(result.ok).toBe(true);
    const md = messages[0].content;
    expect(md).toContain('### Findings');
    expect(md).not.toContain('### Decisions');
    expect(md).not.toContain('### Asks');
    expect(md).not.toContain('### Actions');
    expect(md).not.toContain('### Sources');
  });
});
