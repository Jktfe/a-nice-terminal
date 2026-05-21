import { describe, it, expect, beforeEach } from 'vitest';
import {
  purgeRouterInjectedAgentMessages, ensureLinkedRoomGuffPurgedOnce,
  dedupHistoricalTranscriptRows, _resetGuffPurgeBootFlagForTests
} from './linkedRoomAgentGuffPurge';
import { createChatRoom } from './chatRoomStore';
import { postMessage, listMessagesInRoom } from './chatMessageStore';
import { createTerminalRecord } from './terminalRecordsStore';
import { appendTerminalRunEvent, listLatestTerminalRunEvents } from './terminalRunEventsStore';
import { getIdentityDb } from './db';

describe('V4-BLOCKER-C — linked-room agent guff purge', () => {
  let linkedRoomId: string;
  let normalRoomId: string;

  beforeEach(() => {
    const db = getIdentityDb();
    try { db.prepare(`DELETE FROM chat_messages`).run(); } catch {}
    try { db.prepare(`DELETE FROM chat_rooms`).run(); } catch {}
    try { db.prepare(`DELETE FROM terminal_records`).run(); } catch {}
    _resetGuffPurgeBootFlagForTests();

    const linked = createChatRoom({ name: 'Terminal: t_x', whoCreatedIt: '@you' });
    linkedRoomId = linked.id;
    const normal = createChatRoom({ name: 'antDevTeam', whoCreatedIt: '@you' });
    normalRoomId = normal.id;
    createTerminalRecord({
      sessionId: 't_x', name: 't_x', linkedChatRoomId: linkedRoomId
    });
  });

  it('deletes kind=agent rows in linked rooms only', () => {
    postMessage({ roomId: linkedRoomId, authorHandle: '@t-x', body: 'router guff 1', kind: 'agent' });
    postMessage({ roomId: linkedRoomId, authorHandle: '@you', body: 'human msg', kind: 'human' });
    postMessage({ roomId: normalRoomId, authorHandle: '@claude2', body: 'real agent post', kind: 'agent' });

    const removed = purgeRouterInjectedAgentMessages();
    expect(removed).toBe(1);

    // Linked room: agent guff gone, human stays.
    const linkedMsgs = listMessagesInRoom(linkedRoomId);
    expect(linkedMsgs.filter((m) => m.kind === 'agent')).toHaveLength(0);
    expect(linkedMsgs.filter((m) => m.kind === 'human')).toHaveLength(1);

    // Normal coordination room: legitimate @agent post untouched.
    const normalMsgs = listMessagesInRoom(normalRoomId);
    expect(normalMsgs.filter((m) => m.kind === 'agent')).toHaveLength(1);
  });

  it('is idempotent — second run deletes nothing', () => {
    postMessage({ roomId: linkedRoomId, authorHandle: '@t-x', body: 'guff', kind: 'agent' });
    expect(purgeRouterInjectedAgentMessages()).toBe(1);
    expect(purgeRouterInjectedAgentMessages()).toBe(0);
  });

  it('ensureLinkedRoomGuffPurgedOnce runs once per process', () => {
    postMessage({ roomId: linkedRoomId, authorHandle: '@t-x', body: 'guff', kind: 'agent' });
    ensureLinkedRoomGuffPurgedOnce();
    expect(listMessagesInRoom(linkedRoomId).filter((m) => m.kind === 'agent')).toHaveLength(0);
    // Second call is a no-op (flag set) — add another guff row, it survives.
    postMessage({ roomId: linkedRoomId, authorHandle: '@t-x', body: 'guff2', kind: 'agent' });
    ensureLinkedRoomGuffPurgedOnce();
    expect(listMessagesInRoom(linkedRoomId).filter((m) => m.kind === 'agent')).toHaveLength(1);
  });

  it('no-op when there are no linked rooms', () => {
    getIdentityDb().prepare(`DELETE FROM terminal_records`).run();
    postMessage({ roomId: normalRoomId, authorHandle: '@claude2', body: 'real', kind: 'agent' });
    expect(purgeRouterInjectedAgentMessages()).toBe(0);
    expect(listMessagesInRoom(normalRoomId).filter((m) => m.kind === 'agent')).toHaveLength(1);
  });
});

describe('V4-BLOCKER-C — historical transcript dedup (soft-delete)', () => {
  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_run_events`).run(); } catch {}
  });

  it('soft-deletes pre-fix NULL-id transcript dupes, keeps earliest', () => {
    // Simulate pre-idempotency multiplication: same (terminal,kind,text)
    // ingested 4x with NULL transcript_event_id.
    for (let n = 0; n < 4; n++) {
      appendTerminalRunEvent({
        terminalId: 't_hist', kind: 'message', text: 'duplicated reply',
        trust: 'high', source: 'transcript'
      });
    }
    appendTerminalRunEvent({
      terminalId: 't_hist', kind: 'message', text: 'unique reply',
      trust: 'high', source: 'transcript'
    });
    const removed = dedupHistoricalTranscriptRows();
    expect(removed).toBe(3); // 4 dupes → keep 1, soft-delete 3
    const visible = listLatestTerminalRunEvents('t_hist', 50);
    expect(visible.filter((e) => e.text === 'duplicated reply')).toHaveLength(1);
    expect(visible.filter((e) => e.text === 'unique reply')).toHaveLength(1);
  });

  it('is idempotent — second sweep finds nothing', () => {
    for (let n = 0; n < 3; n++) {
      appendTerminalRunEvent({
        terminalId: 't_hist2', kind: 'message', text: 'x',
        trust: 'high', source: 'transcript'
      });
    }
    expect(dedupHistoricalTranscriptRows()).toBe(2);
    expect(dedupHistoricalTranscriptRows()).toBe(0);
  });

  it('does NOT touch rows that have a transcript_event_id (post-fix)', () => {
    appendTerminalRunEvent({
      terminalId: 't_hist3', kind: 'message', text: 'keyed',
      trust: 'high', source: 'transcript', transcriptEventId: 'uuid#0'
    });
    appendTerminalRunEvent({
      terminalId: 't_hist3', kind: 'message', text: 'keyed2',
      trust: 'high', source: 'transcript', transcriptEventId: 'uuid#1'
    });
    expect(dedupHistoricalTranscriptRows()).toBe(0);
    expect(listLatestTerminalRunEvents('t_hist3', 10)).toHaveLength(2);
  });

  it('does NOT touch non-transcript rows (pty/classifier)', () => {
    appendTerminalRunEvent({ terminalId: 't_hist4', kind: 'raw', text: 'r', trust: 'raw', source: 'pty' });
    appendTerminalRunEvent({ terminalId: 't_hist4', kind: 'raw', text: 'r', trust: 'raw', source: 'pty' });
    expect(dedupHistoricalTranscriptRows()).toBe(0);
    expect(listLatestTerminalRunEvents('t_hist4', 10)).toHaveLength(2);
  });
});
