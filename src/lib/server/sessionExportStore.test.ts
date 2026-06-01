import { beforeEach, describe, expect, it } from 'vitest';
import { createChatRoom, resetChatRoomStoreForTests } from './chatRoomStore';
import { postMessage, resetChatMessageStoreForTests } from './chatMessageStore';
import { createTerminalRecord, deleteTerminalRecord } from './terminalRecordsStore';
import { exportSession } from './sessionExportStore';

describe('sessionExportStore', () => {
  beforeEach(() => {
    resetChatMessageStoreForTests();
    resetChatRoomStoreForTests();
  });

  it('exports full room history as JSON, markdown, and text', () => {
    const room = createChatRoom({ name: 'export-room', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@you', body: 'hello' });
    postMessage({ roomId: room.id, authorHandle: '@agent', kind: 'agent', body: 'world' });

    const json = exportSession({ sessionId: room.id, format: 'json' });
    expect(json.resolvedFrom).toBe('room');
    expect(json.room.id).toBe(room.id);
    expect(json.messageCount).toBe(2);
    expect(JSON.parse(json.body).messages).toHaveLength(2);

    const markdown = exportSession({ sessionId: room.id, format: 'markdown' });
    expect(markdown.body).toContain('# export-room');
    expect(markdown.body).toContain('**@you**: hello');
    expect(markdown.body).toContain('**@agent**: world');

    const text = exportSession({ sessionId: room.id, format: 'text' });
    expect(text.body).toContain('@you: hello');
    expect(text.body).toContain('@agent: world');
  });

  it('resolves a terminal session id through linked_chat_room_id', () => {
    const room = createChatRoom({ name: 'linked', whoCreatedIt: '@you' });
    postMessage({ roomId: room.id, authorHandle: '@agent', kind: 'agent', body: 'linked transcript' });
    createTerminalRecord({
      sessionId: 'term_export_1',
      name: 'Terminal Export 1',
      linkedChatRoomId: room.id,
      handle: '@agent'
    });
    try {
      const result = exportSession({ sessionId: 'term_export_1', format: 'json' });
      expect(result.resolvedFrom).toBe('terminal');
      expect(result.session.id).toBe('term_export_1');
      expect(result.room.id).toBe(room.id);
      expect(JSON.parse(result.body).messages[0].body).toBe('linked transcript');
    } finally {
      deleteTerminalRecord('term_export_1');
    }
  });

  it('throws when the session id does not resolve to a room or terminal linked chat', () => {
    expect(() => exportSession({ sessionId: 'missing', format: 'json' })).toThrow(/No session or room/);
  });
});
