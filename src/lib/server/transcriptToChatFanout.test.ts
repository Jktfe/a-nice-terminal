/**
 * transcriptToChatFanout — tests for the Chat-view gap closer (2026-05-21).
 *
 * Per JWPK directive: helper must NEVER break transcript ingestion, must
 * dedupe on (terminal_id, transcript_event_id), and must only fan out
 * kind='message' events (commands already in room via /agent-launch).
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  fanoutMessageToLinkedChatRoom,
  _resetTranscriptToChatFanoutForTests
} from './transcriptToChatFanout';
import {
  createTerminalRecord, deleteTerminalRecord
} from './terminalRecordsStore';
import { createChatRoom } from './chatRoomStore';
import { listMessagesInRoom } from './chatMessageStore';
import { getIdentityDb } from './db';

describe('transcriptToChatFanout', () => {
  let SID: string;
  let roomId: string;

  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_records`).run(); } catch {}
    try { getIdentityDb().prepare(`DELETE FROM chat_rooms`).run(); } catch {}
    try { getIdentityDb().prepare(`DELETE FROM chat_messages`).run(); } catch {}
    _resetTranscriptToChatFanoutForTests();
    SID = 't_fan_' + Math.random().toString(36).slice(2, 10);
    const room = createChatRoom({ name: `Terminal: ${SID}`, whoCreatedIt: '@you' });
    roomId = room.id;
    createTerminalRecord({
      sessionId: SID,
      name: `fan-test-${SID}`,
      agentKind: 'pi',
      linkedChatRoomId: roomId,
      handle: '@worker'
    });
  });

  afterEach(() => {
    _resetTranscriptToChatFanoutForTests();
    try { deleteTerminalRecord(SID); } catch {}
  });

  it('posts a kind=message event to the linked chat room as kind=agent', () => {
    const posted = fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID,
      transcriptEventId: 'evt-1',
      kind: 'message',
      text: 'Sure — here is the answer you asked for, James.'
    });
    expect(posted).toBe(true);
    const msgs = listMessagesInRoom(roomId);
    const agent = msgs.find((m) => m.kind === 'agent');
    expect(agent).toBeDefined();
    expect(agent?.body).toBe('Sure — here is the answer you asked for, James.');
    expect(agent?.authorHandle).toBe('@worker');
  });

  it('does NOT post kind=command (already in room via agent-launch)', () => {
    const posted = fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID,
      transcriptEventId: 'evt-cmd',
      kind: 'command',
      text: 'tell me a joke'
    });
    expect(posted).toBe(false);
    expect(listMessagesInRoom(roomId)).toHaveLength(0);
  });

  it('does NOT post kind=thinking or kind=tool_call (ANT-view only)', () => {
    expect(fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: 'e-th', kind: 'thinking',
      text: 'reasoning here'
    })).toBe(false);
    expect(fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: 'e-tc', kind: 'tool_call',
      text: 'Bash {"cmd":"ls"}'
    })).toBe(false);
    expect(listMessagesInRoom(roomId)).toHaveLength(0);
  });

  it('dedupes the same transcript_event_id (restart re-read safety)', () => {
    const first = fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: 'evt-dup',
      kind: 'message', text: 'Identical body on re-read'
    });
    expect(first).toBe(true);
    const second = fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: 'evt-dup',
      kind: 'message', text: 'Identical body on re-read'
    });
    expect(second).toBe(false);
    expect(listMessagesInRoom(roomId)).toHaveLength(1);
  });

  it('returns false when terminal record has no linked_chat_room_id', () => {
    const unlinked = 't_unlinked_' + Math.random().toString(36).slice(2, 10);
    createTerminalRecord({
      sessionId: unlinked, name: `unlinked-${unlinked}`, agentKind: 'pi'
    });
    const posted = fanoutMessageToLinkedChatRoom({
      terminalSessionId: unlinked, transcriptEventId: 'e1',
      kind: 'message', text: 'No room to receive me'
    });
    expect(posted).toBe(false);
    deleteTerminalRecord(unlinked);
  });

  it('returns false for unknown terminal session (no record)', () => {
    const posted = fanoutMessageToLinkedChatRoom({
      terminalSessionId: 't_does_not_exist',
      transcriptEventId: 'evt-x',
      kind: 'message', text: 'orphan event'
    });
    expect(posted).toBe(false);
  });

  it('returns false on empty text', () => {
    expect(fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: 'e-empty',
      kind: 'message', text: ''
    })).toBe(false);
    expect(fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: 'e-ws',
      kind: 'message', text: '   '
    })).toBe(false);
    expect(listMessagesInRoom(roomId)).toHaveLength(0);
  });

  it('returns false when transcriptEventId is missing (no dedupe key)', () => {
    expect(fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: '',
      kind: 'message', text: 'no key'
    })).toBe(false);
  });

  it('uses deriveHandle fallback when no explicit handle on record', () => {
    const fallback = 't_fb_' + Math.random().toString(36).slice(2, 10);
    const room = createChatRoom({ name: `Room ${fallback}`, whoCreatedIt: '@you' });
    createTerminalRecord({
      sessionId: fallback,
      name: 'Pretty Name Here',
      agentKind: 'pi',
      linkedChatRoomId: room.id
      // no handle — derive @pretty-name-here
    });
    fanoutMessageToLinkedChatRoom({
      terminalSessionId: fallback, transcriptEventId: 'e-fb',
      kind: 'message', text: 'derived-handle reply body'
    });
    const msgs = listMessagesInRoom(room.id);
    expect(msgs[0]?.authorHandle).toBe('@pretty-name-here');
    deleteTerminalRecord(fallback);
  });

  it('honours derivedHandle override when supplied', () => {
    fanoutMessageToLinkedChatRoom({
      terminalSessionId: SID, transcriptEventId: 'e-ovr',
      kind: 'message', text: 'override handle body',
      derivedHandle: '@override'
    });
    const msgs = listMessagesInRoom(roomId);
    expect(msgs[0]?.authorHandle).toBe('@override');
  });
});
