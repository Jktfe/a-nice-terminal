import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { upsertTerminal, updatePaneTarget, markPaneVerified } from './terminalsStore';
import { addMembership } from './roomMembershipsStore';
import { resetChatRoomStoreForTests, createChatRoom, inviteAgentToRoom } from './chatRoomStore';
import { resetChatMessageStoreForTests, postMessage } from './chatMessageStore';
import { createTerminalRecord } from './terminalRecordsStore';
import {
  fanoutMessageToRoomTerminals,
  resetFanoutQueueForTests,
  getFanoutQueueForTests
} from './pty-inject-fanout';
import { setSpawnImplForTests, resetBridgeStateForTests } from './pty-inject-bridge';
import { setRoomMode } from './roomModesStore';
import { setResponders } from './roomRespondersStore';
import { listMessagesInRoom } from './chatMessageStore';
import { resetNoResponderRateLimitForTests } from './pty-inject-fanout';
import { listReadersForMessage } from './messageReadReceiptStore';
import { subscribeToRoom, unsubscribeFromRoom } from './eventBroadcast';
import { setRoomAlias } from './chatRoomAliasStore';
import { createClaim, resetEntityClaimStoreForTests } from './entityClaimStore';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-fanout-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetFanoutQueueForTests();
  resetBridgeStateForTests();
  resetNoResponderRateLimitForTests();
  resetEntityClaimStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetFanoutQueueForTests();
  resetBridgeStateForTests();
  resetEntityClaimStoreForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDbPath === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDbPath;
});

function setupRoomAndMember(roomName: string, handle: string, pane: string | null) {
  const room = createChatRoom({ name: roomName, whoCreatedIt: '@test' });
  const terminal = upsertTerminal({ pid: 100, pid_start: 'p', name: `${handle}-terminal` });
  if (pane) updatePaneTarget(terminal.id, pane, 'claude_code');
  addMembership({ room_id: room.id, handle, terminal_id: terminal.id });
  return { roomId: room.id, terminalId: terminal.id };
}

describe('fanoutMessageToRoomTerminals — recursion lockout', () => {
  it('does NOT enqueue when message.kind is "system" (stale-marker recursion guard)', () => {
    const { roomId, terminalId } = setupRoomAndMember('r-system', '@recip', '%23');
    const systemMessage = postMessage({ roomId, authorHandle: '@bot', body: 'hi', kind: 'agent' });
    const mutated = { ...systemMessage, kind: 'system' as const };
    fanoutMessageToRoomTerminals(roomId, mutated);
    expect(getFanoutQueueForTests().pendingCountForTests(`${roomId}::${terminalId}`)).toBe(0);
  });

  it('does NOT enqueue when message.kind is "system-break"', () => {
    const { roomId, terminalId } = setupRoomAndMember('r-break', '@recip', '%23');
    const m = postMessage({ roomId, authorHandle: '@bot', body: 'hi', kind: 'agent' });
    fanoutMessageToRoomTerminals(roomId, { ...m, kind: 'system-break' as const });
    expect(getFanoutQueueForTests().pendingCountForTests(`${roomId}::${terminalId}`)).toBe(0);
  });
});

describe('fanoutMessageToRoomTerminals — B2 room-scoped queue keys', () => {
  it('same handle in two different rooms does NOT cross-batch (queue key is room+terminal)', () => {
    const roomA = createChatRoom({ name: 'room-A', whoCreatedIt: '@test' });
    const roomB = createChatRoom({ name: 'room-B', whoCreatedIt: '@test' });
    const tA = upsertTerminal({ pid: 1, pid_start: 'pa', name: 'cross-batch-A' });
    const tB = upsertTerminal({ pid: 2, pid_start: 'pb', name: 'cross-batch-B' });
    updatePaneTarget(tA.id, '%pA', 'claude_code');
    updatePaneTarget(tB.id, '%pB', 'claude_code');
    addMembership({ room_id: roomA.id, handle: '@same', terminal_id: tA.id });
    addMembership({ room_id: roomB.id, handle: '@same', terminal_id: tB.id });
    const messageA = postMessage({ roomId: roomA.id, authorHandle: '@x', body: '@same msg-A', kind: 'human' });
    const messageB = postMessage({ roomId: roomB.id, authorHandle: '@x', body: '@same msg-B', kind: 'human' });
    fanoutMessageToRoomTerminals(roomA.id, messageA);
    fanoutMessageToRoomTerminals(roomB.id, messageB);
    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${roomA.id}::${tA.id}`)).toBe(1);
    expect(q.pendingCountForTests(`${roomB.id}::${tB.id}`)).toBe(1);
    expect(q.pendingCountForTests('@same')).toBe(0);
  });
});

describe('fanoutMessageToRoomTerminals — mention-targeted routing', () => {
  it('does NOT enqueue an unmentioned brainstorm message to room members', () => {
    const room = createChatRoom({ name: 'fanout-room', whoCreatedIt: '@test' });
    const t1 = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const t2 = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'recip-1' });
    const t3 = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'recip-2' });
    updatePaneTarget(t2.id, '%recip1', 'claude_code');
    updatePaneTarget(t3.id, '%recip2', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@recip1', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@recip2', terminal_id: t3.id });
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'hello', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);
    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${t1.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${t2.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
  });

  it('plain @you room posts fan out to all non-browser member terminals', () => {
    const room = createChatRoom({ name: 'jwpk-fanout-room', whoCreatedIt: '@you' });
    const jwpk = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'jwpk-term' });
    const codex = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'codex-term' });
    const svelte = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'svelte-term' });
    const browser = upsertTerminal({
      pid: 4,
      pid_start: 'p4',
      name: 'browser-term',
      source: 'browser-session-default'
    });
    updatePaneTarget(jwpk.id, '%jwpk', 'claude_code');
    updatePaneTarget(codex.id, '%codex', 'claude_code');
    updatePaneTarget(svelte.id, '%svelte', 'claude_code');
    updatePaneTarget(browser.id, '%browser', 'claude_code');
    addMembership({ room_id: room.id, handle: '@you', terminal_id: jwpk.id });
    addMembership({ room_id: room.id, handle: '@evolveantcodex', terminal_id: codex.id });
    addMembership({ room_id: room.id, handle: '@evolveantsvelte', terminal_id: svelte.id });
    addMembership({ room_id: room.id, handle: '@you-browser', terminal_id: browser.id });

    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'Please look at this room update',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${jwpk.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${codex.id}`)).toBe(1);
    expect(q.pendingCountForTests(`${room.id}::${svelte.id}`)).toBe(1);
    expect(q.pendingCountForTests(`${room.id}::${browser.id}`)).toBe(0);
  });

  it('active working claims route claimed-message fanout only to the claimant', () => {
    const room = createChatRoom({ name: 'claimed-work-room', whoCreatedIt: '@you' });
    const jwpk = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'jwpk-term' });
    const codex = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'codex-term' });
    const svelte = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'svelte-term' });
    updatePaneTarget(jwpk.id, '%jwpk', 'claude_code');
    updatePaneTarget(codex.id, '%codex', 'claude_code');
    updatePaneTarget(svelte.id, '%svelte', 'claude_code');
    addMembership({ room_id: room.id, handle: '@you', terminal_id: jwpk.id });
    addMembership({ room_id: room.id, handle: '@evolveantcodex', terminal_id: codex.id });
    addMembership({ room_id: room.id, handle: '@evolveantsvelte', terminal_id: svelte.id });

    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'Please take this claimed work item',
      kind: 'human'
    });
    createClaim({
      entity_kind: 'message',
      entity_id: message.id,
      claim_kind: 'working',
      claimed_by_handle: '@evolveantcodex'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${jwpk.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${codex.id}`)).toBe(1);
    expect(q.pendingCountForTests(`${room.id}::${svelte.id}`)).toBe(0);
  });

  it('@you with a bare @mention routes only to the mentioned member terminal', () => {
    const room = createChatRoom({ name: 'jwpk-targeted-room', whoCreatedIt: '@you' });
    const jwpk = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'jwpk-term' });
    const codex = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'codex-term' });
    const svelte = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'svelte-term' });
    updatePaneTarget(jwpk.id, '%jwpk', 'claude_code');
    updatePaneTarget(codex.id, '%codex', 'claude_code');
    updatePaneTarget(svelte.id, '%svelte', 'claude_code');
    addMembership({ room_id: room.id, handle: '@you', terminal_id: jwpk.id });
    addMembership({ room_id: room.id, handle: '@evolveantcodex', terminal_id: codex.id });
    addMembership({ room_id: room.id, handle: '@evolveantsvelte', terminal_id: svelte.id });

    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: '@evolveantsvelte please check this',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${jwpk.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${codex.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${svelte.id}`)).toBe(1);
  });

  it('enqueues only the bare @mentioned room member', () => {
    const room = createChatRoom({ name: 'targeted-room', whoCreatedIt: '@test' });
    const t1 = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const t2 = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'recip-1' });
    const t3 = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'recip-2' });
    updatePaneTarget(t2.id, '%recip1', 'claude_code');
    updatePaneTarget(t3.id, '%recip2', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@recip1', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@recip2', terminal_id: t3.id });

    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@recip1 please check this', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);

    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${t1.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(q.pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
  });

  it('does NOT enqueue bracketed informational [@handle] references', () => {
    const room = createChatRoom({ name: 'bracketed-room', whoCreatedIt: '@test' });
    const t1 = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const t2 = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'recip-1' });
    updatePaneTarget(t2.id, '%recip1', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@recip1', terminal_id: t2.id });

    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'FYI [@recip1] no action', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);

    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(0);
  });

  it('enqueues a room member when their room-scoped alias is bare-mentioned', () => {
    const room = createChatRoom({ name: 'alias-room', whoCreatedIt: '@test' });
    const t1 = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const t2 = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'codex-term' });
    updatePaneTarget(t2.id, '%codex', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@evolveantcodex', terminal_id: t2.id });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@codex' });

    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@codex please check this', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);

    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
  });

  it('bare @everyone enqueues every room member except sender', () => {
    const room = createChatRoom({ name: 'everyone-room', whoCreatedIt: '@test' });
    const t1 = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const t2 = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'recip-1' });
    const t3 = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'recip-2' });
    updatePaneTarget(t2.id, '%recip1', 'claude_code');
    updatePaneTarget(t3.id, '%recip2', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@recip1', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@recip2', terminal_id: t3.id });

    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@everyone deploy check', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);

    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${t1.id}`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(q.pendingCountForTests(`${room.id}::${t3.id}`)).toBe(1);
  });

  it('skips members whose terminal has no tmux_target_pane', () => {
    const { roomId, terminalId } = setupRoomAndMember('no-pane-room', '@nopane', null);
    const message = postMessage({ roomId, authorHandle: '@sender', body: 'hi', kind: 'human' });
    fanoutMessageToRoomTerminals(roomId, message);
    expect(getFanoutQueueForTests().pendingCountForTests(`${roomId}::${terminalId}`)).toBe(0);
  });

  it('marks terminal recipients read and broadcasts a message_read event when delivery flushes', () => {
    const room = createChatRoom({ name: 'read-receipt-room', whoCreatedIt: '@test' });
    const sender = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const recipient = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'recipient-term' });
    updatePaneTarget(recipient.id, '%recipient', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: sender.id });
    addMembership({ room_id: room.id, handle: '@recip', terminal_id: recipient.id });

    setSpawnImplForTests(() => ({
      pid: 1,
      stdout: Buffer.from('│ > ready prompt'),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: null,
      output: []
    } as any));

    const emitted: unknown[] = [];
    const decoder = new TextDecoder();
    const controller = {
      enqueue(chunk: Uint8Array) {
        const text = decoder.decode(chunk);
        const match = /^data: (.*)\n\n$/.exec(text);
        if (match) emitted.push(JSON.parse(match[1]));
      }
    } as ReadableStreamDefaultController<Uint8Array>;
    subscribeToRoom(room.id, controller);

    try {
      const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@recip hello', kind: 'human' });
      fanoutMessageToRoomTerminals(room.id, message);
      getFanoutQueueForTests().immediateFlush(`${room.id}::${recipient.id}`);

      expect(listReadersForMessage(message.id).map((r) => r.readerHandle)).toEqual(['@recip']);
      expect(emitted).toContainEqual({
        type: 'message_read',
        roomId: room.id,
        messageId: message.id,
        readerHandle: '@recip',
        readers: expect.arrayContaining([
          expect.objectContaining({ messageId: message.id, readerHandle: '@recip' })
        ])
      });
    } finally {
      unsubscribeFromRoom(room.id, controller);
    }
  });

  it('linked-room direct path falls back to terminal_records pane when identity row has no pane', () => {
    const room = createChatRoom({ name: 'linked-direct-no-pane', whoCreatedIt: '@test' });
    const identityTerminal = upsertTerminal({ pid: 44, pid_start: 'p44', name: 'linked-identity-no-pane' });
    createTerminalRecord({
      sessionId: identityTerminal.id,
      name: 'linked-record-no-pane',
      linkedChatRoomId: room.id,
      tmuxTargetPane: '%linked-record-pane',
      agentKind: 'codex_cli',
      handle: '@linked-record'
    });
    const calls: { args: string[]; input?: string }[] = [];
    setSpawnImplForTests((bin, args, options) => {
      calls.push({
        args,
        input: typeof options.input === 'string' ? options.input : options.input?.toString('utf8')
      });
      return {
        pid: 1,
        stdout: Buffer.from('ready prompt'),
        stderr: Buffer.alloc(0),
        status: 0,
        signal: null,
        output: []
      } as any;
    });
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'linked hello', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);

    const q = getFanoutQueueForTests();
    const queueKey = `${room.id}::${identityTerminal.id}`;
    expect(q.pendingCountForTests(queueKey)).toBe(1);
    q.immediateFlush(queueKey);

    const captureCall = calls.find((c) => c.args[0] === 'capture-pane');
    expect(captureCall?.args).toContain('%linked-record-pane');
    expect(calls.some((c) => c.args[0] === 'paste-buffer')).toBe(true);
    const loadCall = calls.find((c) => c.args[0] === 'load-buffer');
    expect(loadCall?.input).toContain('linked hello');
    expect(loadCall?.input).toContain(`ant chat send ${room.id} --msg`);
    expect(listReadersForMessage(message.id).map((r) => r.readerHandle)).toEqual(['@linked-record']);
  });

  it('linked-room direct path narrows bare @mentions to the matching terminal record', () => {
    const room = createChatRoom({ name: 'linked-targeted-room', whoCreatedIt: '@test' });
    createTerminalRecord({
      sessionId: 'linked-codex',
      name: 'linked codex',
      linkedChatRoomId: room.id,
      tmuxTargetPane: '%linked-codex',
      agentKind: 'codex_cli',
      handle: '@evolveantcodex'
    });
    createTerminalRecord({
      sessionId: 'linked-svelte',
      name: 'linked svelte',
      linkedChatRoomId: room.id,
      tmuxTargetPane: '%linked-svelte',
      agentKind: 'claude_code',
      handle: '@evolveantsvelte'
    });

    const message = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: '@evolveantsvelte please review the upload UX',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::linked-codex`)).toBe(0);
    expect(q.pendingCountForTests(`${room.id}::linked-svelte`)).toBe(1);
  });

  it('linked-room direct path treats bracketed [@handle] as informational text', () => {
    const room = createChatRoom({ name: 'linked-bracket-room', whoCreatedIt: '@test' });
    createTerminalRecord({
      sessionId: 'linked-codex',
      name: 'linked codex',
      linkedChatRoomId: room.id,
      tmuxTargetPane: '%linked-codex',
      agentKind: 'codex_cli',
      handle: '@evolveantcodex'
    });

    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: 'FYI [@evolveantcodex] no action',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::linked-codex`)).toBe(0);
  });

  it('linked-room direct path preserves plain @you broadcast and explicit @everyone broadcast', () => {
    const room = createChatRoom({ name: 'linked-broadcast-room', whoCreatedIt: '@you' });
    createTerminalRecord({
      sessionId: 'linked-codex',
      name: 'linked codex',
      linkedChatRoomId: room.id,
      tmuxTargetPane: '%linked-codex',
      agentKind: 'codex_cli',
      handle: '@evolveantcodex'
    });
    createTerminalRecord({
      sessionId: 'linked-svelte',
      name: 'linked svelte',
      linkedChatRoomId: room.id,
      tmuxTargetPane: '%linked-svelte',
      agentKind: 'claude_code',
      handle: '@evolveantsvelte'
    });

    const plain = postMessage({
      roomId: room.id,
      authorHandle: '@you',
      body: 'Please all check the room status',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, plain);

    const everyone = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: '@everyone deploy check',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, everyone);

    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::linked-codex`)).toBe(2);
    expect(q.pendingCountForTests(`${room.id}::linked-svelte`)).toBe(2);
  });
});

describe('fanoutMessageToRoomTerminals — room-mode integration (M3.b.4)', () => {
  it('mode=closed returns early and enqueues ZERO members (defensive race-guard)', () => {
    const { roomId, terminalId } = setupRoomAndMember('closed-room', '@recip', '%cz');
    setRoomMode({ roomId, mode: 'closed', set_by: '@admin' });
    const message = postMessage({ roomId, authorHandle: '@sender', body: 'leak?', kind: 'human' });
    fanoutMessageToRoomTerminals(roomId, message);
    expect(getFanoutQueueForTests().pendingCountForTests(`${roomId}::${terminalId}`)).toBe(0);
  });

  // M3.b.4 had an "emits warn AND still enqueues like brainstorm" test here for
  // the temporary heads-down-falls-back-to-brainstorm behaviour. M3.b.5 replaces
  // that with proper picker routing (see the M3.b.5 describe block below); the
  // old warn-and-enqueue test is superseded and removed.

  it('mode default brainstorm (no row stored) does not enqueue without a direct mention', () => {
    const { roomId, terminalId } = setupRoomAndMember('default-room', '@recip', '%def');
    const message = postMessage({ roomId, authorHandle: '@sender', body: 'hi', kind: 'human' });
    fanoutMessageToRoomTerminals(roomId, message);
    expect(getFanoutQueueForTests().pendingCountForTests(`${roomId}::${terminalId}`)).toBe(0);
  });
});

describe('fanoutMessageToRoomTerminals — heads-down routing (M3.b.5 JWPK-C)', () => {
  function setupHdRoomWithTwoResponders() {
    const room = createChatRoom({ name: 'hd-room', whoCreatedIt: '@test' });
    const t1 = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const t2 = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'r1-term' });
    const t3 = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'r2-term' });
    updatePaneTarget(t2.id, '%r1', 'claude_code');
    updatePaneTarget(t3.id, '%r2', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@r1', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@r2', terminal_id: t3.id });
    setRoomMode({ roomId: room.id, mode: 'heads-down', set_by: '@admin' });
    return { room, t1, t2, t3 };
  }

  it('does not use the responder picker for unmentioned messages', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'hi', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(0);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(0);
  });

  it('bare @handle in heads-down targets only that member', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@r1 please check', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(0);
  });

  it('forceBroadcastToAll enqueues every member except sender', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: '@everyone check the deploy',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message, { forceBroadcastToAll: true });

    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(1);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(0);
  });

  it('bracketed [@everyone] in heads-down does not inject', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: 'FYI [@everyone] — no action needed',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(0);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(0);
  });

  it('bare @everyone in heads-down broadcasts to all members', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: 'Hey @everyone — urgent deploy',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    expect(getFanoutQueueForTests().pendingCountForTests(room.id + "::" + t2.id)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(room.id + "::" + t3.id)).toBe(1);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(0);
  });
});

describe('fanoutMessageToRoomTerminals — M3.4a-v2 T3d touchpoint integration', () => {
  it('targeted fanout BUMPS last_pty_byte_at_ms on each successfully enqueued recipient terminal', async () => {
    const { getTerminalById } = await import('./terminalsStore');
    const room = createChatRoom({ name: 't3d-brainstorm', whoCreatedIt: '@test' });
    const sender = upsertTerminal({ pid: 1101, pid_start: 'p1', name: 't3d-sender' });
    const recip1 = upsertTerminal({ pid: 1102, pid_start: 'p2', name: 't3d-r1' });
    const recip2 = upsertTerminal({ pid: 1103, pid_start: 'p3', name: 't3d-r2' });
    updatePaneTarget(recip1.id, '%t3d-r1', 'claude_code');
    updatePaneTarget(recip2.id, '%t3d-r2', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: sender.id });
    addMembership({ room_id: room.id, handle: '@r1', terminal_id: recip1.id });
    addMembership({ room_id: room.id, handle: '@r2', terminal_id: recip2.id });

    expect(getTerminalById(recip1.id)?.last_pty_byte_at_ms ?? null).toBeNull();
    expect(getTerminalById(recip2.id)?.last_pty_byte_at_ms ?? null).toBeNull();

    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@r1 @r2 targeted', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);

    expect(typeof getTerminalById(recip1.id)?.last_pty_byte_at_ms).toBe('number');
    expect(typeof getTerminalById(recip2.id)?.last_pty_byte_at_ms).toBe('number');
    expect(getTerminalById(sender.id)?.last_pty_byte_at_ms ?? null).toBeNull();
  });

  it('heads-down targeted message BUMPS last_pty_byte_at_ms on the mentioned terminal only', async () => {
    const { getTerminalById } = await import('./terminalsStore');
    const room = createChatRoom({ name: 't3d-hd', whoCreatedIt: '@test' });
    const sender = upsertTerminal({ pid: 1201, pid_start: 'p1', name: 't3d-hd-sender' });
    const t2 = upsertTerminal({ pid: 1202, pid_start: 'p2', name: 't3d-hd-r1' });
    const t3 = upsertTerminal({ pid: 1203, pid_start: 'p3', name: 't3d-hd-r2' });
    updatePaneTarget(t2.id, '%t3d-hd-r1', 'claude_code');
    updatePaneTarget(t3.id, '%t3d-hd-r2', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: sender.id });
    addMembership({ room_id: room.id, handle: '@r1', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@r2', terminal_id: t3.id });
    setRoomMode({ roomId: room.id, mode: 'heads-down', set_by: '@admin' });
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);

    expect(getTerminalById(t2.id)?.last_pty_byte_at_ms ?? null).toBeNull();
    expect(getTerminalById(t3.id)?.last_pty_byte_at_ms ?? null).toBeNull();

    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@r1 heads-down msg', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);

    // Only the explicitly mentioned responder (t2) gets the pty-byte touch.
    expect(typeof getTerminalById(t2.id)?.last_pty_byte_at_ms).toBe('number');
    expect(getTerminalById(t3.id)?.last_pty_byte_at_ms ?? null).toBeNull();
  });

});
