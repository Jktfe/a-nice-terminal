import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { _resetTerminalReplyRouterForTests, _internals, routeTerminalEventToLinkedRoom } from './terminalReplyRouter';
import {
  createTerminalRecord, deleteTerminalRecord, updateTerminalRecord
} from './terminalRecordsStore';
import { createChatRoom } from './chatRoomStore';
import { listMessagesInRoom } from './chatMessageStore';
import { getIdentityDb } from './db';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('terminalReplyRouter — noise filters (pure)', () => {
  it('rejects empty + short text', () => {
    expect(_internals.MIN_TEXT_LEN).toBe(30);
  });

  it('isMostlyWordChars true for English prose', () => {
    expect(_internals.isMostlyWordChars('Yes the answer is here for you')).toBe(true);
  });

  it('isMostlyWordChars false for punctuation/box-drawing residue', () => {
    expect(_internals.isMostlyWordChars('  │ │ │ │ ─ ─ ─  ')).toBe(false);
    expect(_internals.isMostlyWordChars('--- === ___ ===')).toBe(false);
  });

  it('hasWordChars true for English text', () => {
    expect(_internals.hasWordChars('hello world this is a reply')).toBe(true);
  });

  it('hasWordChars false for symbol-only', () => {
    expect(_internals.hasWordChars('||| --- ===')).toBe(false);
  });

  it('isNoise catches bypass-permissions footer', () => {
    expect(_internals.isNoise('  bypass permissions  ')).toBe(true);
  });

  it('isNoise catches Remote Control TUI line', () => {
    expect(_internals.isNoise('[Remote Control] active')).toBe(true);
  });

  it('isNoise catches sent/resp/edit hook footer', () => {
    expect(_internals.isNoise('sent: 12 resp: 5 edit: 0')).toBe(true);
  });

  it('isNoise catches box-drawing-only lines', () => {
    expect(_internals.isNoise('│ ─ │ ─ │')).toBe(true);
  });

  it('isNoise catches separator-only lines', () => {
    expect(_internals.isNoise('=========')).toBe(true);
  });

  it('isNoise catches ANT envelope echo', () => {
    expect(_internals.isNoise('[ANT room foo id=bar msg=baz] @you: hi')).toBe(true);
  });

  it('isNoise false for real reply', () => {
    expect(_internals.isNoise('Yes the terminal is working — agentKind is claude.')).toBe(false);
  });
});

describe('terminalReplyRouter — debounce + post (integration)', () => {
  let SID: string;
  let roomId: string;

  beforeEach(() => {
    try { getIdentityDb().prepare(`DELETE FROM terminal_records`).run(); } catch {}
    try { getIdentityDb().prepare(`DELETE FROM chat_rooms`).run(); } catch {}
    try { getIdentityDb().prepare(`DELETE FROM chat_messages`).run(); } catch {}
    _resetTerminalReplyRouterForTests();
    SID = 't_router_' + Math.random().toString(36).slice(2, 10);
    const room = createChatRoom({ name: `Terminal: ${SID}`, whoCreatedIt: '@you' });
    roomId = room.id;
    createTerminalRecord({
      sessionId: SID,
      name: `router-test-${SID}`,
      agentKind: 'claude-code',
      linkedChatRoomId: roomId,
      handle: '@worker'
    });
  });

  afterEach(() => {
    _resetTerminalReplyRouterForTests();
    deleteTerminalRecord(SID);
  });

  it('routes a real agent reply to the linked room as kind=agent', async () => {
    routeTerminalEventToLinkedRoom(SID, 'message', 'Yes the terminal is working — claude here');
    await wait(_internals.DEBOUNCE_MS + 50);
    const msgs = listMessagesInRoom(roomId);
    const agent = msgs.find((m) => m.kind === 'agent');
    expect(agent).toBeDefined();
    expect(agent?.body).toContain('terminal is working');
    expect(agent?.authorHandle).toBe('@worker');
  });

  it('debounces multiple lines into one message', async () => {
    routeTerminalEventToLinkedRoom(SID, 'message', 'Line one of the reply.');
    routeTerminalEventToLinkedRoom(SID, 'message', 'Line two follows immediately.');
    routeTerminalEventToLinkedRoom(SID, 'message', 'Line three closes the thought.');
    await wait(_internals.DEBOUNCE_MS + 50);
    const msgs = listMessagesInRoom(roomId);
    const agentMsgs = msgs.filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(1);
    expect(agentMsgs[0].body).toContain('Line one');
    expect(agentMsgs[0].body).toContain('Line three');
  });

  it('skips noise-only chunks BEFORE adding to debounce buffer', async () => {
    routeTerminalEventToLinkedRoom(SID, 'message', '=========');
    routeTerminalEventToLinkedRoom(SID, 'message', '│ ─ │');
    await wait(_internals.DEBOUNCE_MS + 50);
    const agentMsgs = listMessagesInRoom(roomId).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(0);
  });

  it('skips when debounced text is below MIN_TEXT_LEN', async () => {
    routeTerminalEventToLinkedRoom(SID, 'message', 'short');
    await wait(_internals.DEBOUNCE_MS + 50);
    const agentMsgs = listMessagesInRoom(roomId).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(0);
  });

  it('no-op for terminals with agentKind=null (bare shell)', async () => {
    updateTerminalRecord(SID, { agentKind: null });
    routeTerminalEventToLinkedRoom(SID, 'message', 'This is a bare shell output that should not route');
    await wait(_internals.DEBOUNCE_MS + 50);
    const agentMsgs = listMessagesInRoom(roomId).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(0);
  });

  it('uses derivedHandle when handle is null', async () => {
    updateTerminalRecord(SID, { handle: null });
    routeTerminalEventToLinkedRoom(SID, 'message', 'Reply from a terminal without explicit handle');
    await wait(_internals.DEBOUNCE_MS + 50);
    const agent = listMessagesInRoom(roomId).find((m) => m.kind === 'agent');
    expect(agent).toBeDefined();
    // derived from name `router-test-<sid>` → @router-test-<slug>
    expect(agent?.authorHandle.startsWith('@router-test-')).toBe(true);
  });

  it('skips kind != message events', async () => {
    routeTerminalEventToLinkedRoom(SID, 'thinking', 'thinking text would be plenty long enough');
    routeTerminalEventToLinkedRoom(SID, 'raw', 'raw text would be plenty long enough');
    await wait(_internals.DEBOUNCE_MS + 50);
    const agentMsgs = listMessagesInRoom(roomId).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(0);
  });

  // delta-1 (2026-05-15, JWPK Terminal 23:52):
  it('dedupes identical content within DEDUPE_WINDOW_MS', async () => {
    const reply = 'Yes the terminal is working and ready to receive instructions';
    routeTerminalEventToLinkedRoom(SID, 'message', reply);
    await wait(_internals.DEBOUNCE_MS + 50);
    routeTerminalEventToLinkedRoom(SID, 'message', reply);
    await wait(_internals.DEBOUNCE_MS + 50);
    const agentMsgs = listMessagesInRoom(roomId).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(1);
  }, 15000);

  it('rejects mostly-non-word content even past min-length', async () => {
    // 30+ chars but mostly punctuation: should be filtered.
    routeTerminalEventToLinkedRoom(SID, 'message', '─ │ ─ │ ─ │ ─ │ ─ │ ─ │ ─ │ ─ │');
    await wait(_internals.DEBOUNCE_MS + 50);
    const agentMsgs = listMessagesInRoom(roomId).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(0);
  });

  it('rejects claude TUI status-line shape at routing layer (defense-in-depth)', async () => {
    routeTerminalEventToLinkedRoom(SID, 'message', 'sent:23:56:06 resp:5 cwd Opus 4.7 50% Working RemoteControl');
    await wait(_internals.DEBOUNCE_MS + 50);
    const agentMsgs = listMessagesInRoom(roomId).filter((m) => m.kind === 'agent');
    expect(agentMsgs).toHaveLength(0);
  });
});
