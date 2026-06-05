import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests, getIdentityDb } from './db';
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
import { enterFocus, resetFocusModeStoreForTests } from './focusModeStore';
import { fireFocusTimerPrompts } from './pty-inject-fanout';

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
  resetFocusModeStoreForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetFanoutQueueForTests();
  resetBridgeStateForTests();
  resetEntityClaimStoreForTests();
  resetFocusModeStoreForTests();
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

  it('PID-as-identity (slice 3): mention of an OLDER stacked alias still routes', () => {
    // Pre-slice-3 fanout fell back to findAliasForHandleInRoom which only
    // returned the most-recently-set alias. Stack two aliases, mention the
    // OLDER one, and the agent should still receive — proves the resolver
    // walks the full alias table not just the latest row.
    const room = createChatRoom({ name: 'stacked-alias-room', whoCreatedIt: '@test' });
    const sender = upsertTerminal({ pid: 9001, pid_start: 'p1', name: 'stacked-sender' });
    const target = upsertTerminal({ pid: 9002, pid_start: 'p2', name: 'stacked-target' });
    updatePaneTarget(target.id, '%stacked-target', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: sender.id });
    addMembership({ room_id: room.id, handle: '@evolveantcodex', terminal_id: target.id });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });
    // Older alias first, newer alias second — both should route.
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@codex-mac' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx-latest' });

    const olderMention = postMessage({
      roomId: room.id, authorHandle: '@sender',
      body: '@codex-mac older alias should still route', kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, olderMention);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${target.id}`)).toBe(1);

    const newerMention = postMessage({
      roomId: room.id, authorHandle: '@sender',
      body: '@cdx-latest and the newer alias too', kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, newerMention);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${target.id}`)).toBe(2);
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
        // SSE payload shape is "id: <seq>\ndata: <json>\n\n" (the
        // id: prefix was added later for browser EventSource
        // auto-reconnect via Last-Event-ID). Extract the data: line
        // anywhere in the chunk.
        for (const line of text.split('\n')) {
          if (line.startsWith('data: ')) {
            try { emitted.push(JSON.parse(line.slice(6))); }
            catch { /* not JSON; skip */ }
          }
        }
      }
    } as ReadableStreamDefaultController<Uint8Array>;
    subscribeToRoom(room.id, controller);

    try {
      const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@recip hello', kind: 'human' });
      fanoutMessageToRoomTerminals(room.id, message);
      getFanoutQueueForTests().immediateFlush(`${room.id}::${recipient.id}`);

      expect(listReadersForMessage(message.id).map((r) => r.readerHandle)).toEqual(['@recip']);
      expect(emitted).toContainEqual(expect.objectContaining({
        type: 'message_read',
        roomId: room.id,
        messageId: message.id,
        readerHandle: '@recip',
        readers: expect.arrayContaining([
          expect.objectContaining({ messageId: message.id, readerHandle: '@recip' })
        ])
      }));
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
    expect(loadCall?.input).toContain(`ant chat reply ${message.id} --stdin`);
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
    setSpawnImplForTests(() => ({
      pid: 1,
      stdout: Buffer.from('│ > ready prompt'),
      stderr: Buffer.alloc(0),
      status: 0,
      signal: null,
      output: []
    } as any));
    return { room, t1, t2, t3 };
  }

  it('routes unmentioned heads-down message to first verified responder', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const sysBefore = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'hi', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);
    // First verified responder (t2 / @r1) gets the message
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(sysBefore);
  });

  it('bare @handle in heads-down targets only that member', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    const sysBefore = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    // No responders configured; targetedHandles from @r1 keeps normal routing
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: '@r1 please check', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(sysBefore);
  });

  it('forceBroadcastToAll enqueues every member except sender', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    const sysBefore = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: '@everyone check the deploy',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message, { forceBroadcastToAll: true });

    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(1);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(sysBefore);
  });

  it('bracketed [@everyone] in heads-down routes via responder picker', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const sysBefore = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: 'FYI [@everyone] — no action needed',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    // Bracketed mention is informational; responder picker still routes
    // to the first verified non-sender responder.
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(sysBefore);
  });

  it('bare @everyone in heads-down broadcasts to all members', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const sysBefore = listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length;
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: 'Hey @everyone — urgent deploy',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    expect(getFanoutQueueForTests().pendingCountForTests(room.id + "::" + t2.id)).toBe(1);
    expect(getFanoutQueueForTests().pendingCountForTests(room.id + "::" + t3.id)).toBe(1);
    expect(listMessagesInRoom(room.id).filter((m) => m.kind === 'system').length).toBe(sysBefore);
  });

  // Regression tests for responder routing race safety (JWPK msg_ktbgn99ft1)
  it('agent-unmentioned in heads-down does NOT auto-route to responders', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'agent says hi', kind: 'agent' });
    fanoutMessageToRoomTerminals(room.id, message);
    // Agent-unmentioned bypasses responder picker entirely
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(0);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
  });

  it('duplicate re-fanout of same message only enqueues once', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'hi', kind: 'human' });
    fanoutMessageToRoomTerminals(room.id, message);
    const firstCount = getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`);
    // Re-fanout the same message
    fanoutMessageToRoomTerminals(room.id, message);
    const secondCount = getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`);
    expect(secondCount).toBe(firstCount); // no duplicate enqueue
  });

  it('timed-out working responder is excluded from fallback', () => {
    const { room, t2, t3 } = setupHdRoomWithTwoResponders();
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'hi', kind: 'human' });
    // Simulate a working claim on t2 that is >30s old
    createClaim({
      entity_kind: 'message',
      entity_id: message.id,
      claim_kind: 'working',
      claimed_by_handle: '@r1',
      ttl_ms: 60_000
    });
    // Manually backdate the claim to simulate timeout
    const db = getIdentityDb();
    db.prepare(`UPDATE entity_claims SET claimed_at_ms = claimed_at_ms - 35000 WHERE entity_id = ? AND claim_kind = 'working' AND claimed_by_handle = '@r1'`).run(message.id);
    fanoutMessageToRoomTerminals(room.id, message);
    // t2 is timed out, t3 is first eligible → t3 gets it
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(0);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(1);
  });

  it('fallback only targets verified responders, not all room members', () => {
    const room = createChatRoom({ name: 'hd-fallback', whoCreatedIt: '@test' });
    const t1 = upsertTerminal({ pid: 1, pid_start: 'p1', name: 'sender-term' });
    const t2 = upsertTerminal({ pid: 2, pid_start: 'p2', name: 'r1-term' });
    const t3 = upsertTerminal({ pid: 3, pid_start: 'p3', name: 'r2-term' });
    const t4 = upsertTerminal({ pid: 4, pid_start: 'p4', name: 'non-responder' });
    updatePaneTarget(t2.id, '%r1', 'claude_code');
    updatePaneTarget(t3.id, '%r2', 'claude_code');
    updatePaneTarget(t4.id, '%nr', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: t1.id });
    addMembership({ room_id: room.id, handle: '@r1', terminal_id: t2.id });
    addMembership({ room_id: room.id, handle: '@r2', terminal_id: t3.id });
    addMembership({ room_id: room.id, handle: '@nr', terminal_id: t4.id });
    setRoomMode({ roomId: room.id, mode: 'heads-down', set_by: '@admin' });
    setResponders({ roomId: room.id, terminalIds: [t2.id, t3.id], set_by: '@admin' });
    markPaneVerified(t2.id);
    markPaneVerified(t3.id);
    markPaneVerified(t4.id);
    const message = postMessage({ roomId: room.id, authorHandle: '@sender', body: 'hi', kind: 'human' });
    // @r1 passed AND @r2 stale (unverified) → picker returns null, fallback reached
    createClaim({ entity_kind: 'message', entity_id: message.id, claim_kind: 'pass', claimed_by_handle: '@r1' });
    // Mark t3 pane stale so it is not verified
    const db = getIdentityDb();
    db.prepare(`UPDATE terminals SET pane_status = 'stale' WHERE id = ?`).run(t3.id);
    fanoutMessageToRoomTerminals(room.id, message);
    // t1 sender, t2 passed, t3 stale/unverified, t4 non-responder → no one gets it
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t2.id}`)).toBe(0);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t3.id}`)).toBe(0);
    expect(getFanoutQueueForTests().pendingCountForTests(`${room.id}::${t4.id}`)).toBe(0);
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

describe('fanoutMessageToRoomTerminals — asks-as-pill auto-open (slice 6)', () => {
  it('opens an ask when an agent @-mentions a HUMAN member of the room', async () => {
    const { listAllOpenAsks, resetAskStoreForTests } = await import('./askStore');
    resetAskStoreForTests();
    const room = createChatRoom({ name: 'auto-open-human', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@askr' });
    const sender = upsertTerminal({ pid: 7001, pid_start: 'p1', name: 'auto-open-sender' });
    addMembership({ room_id: room.id, handle: '@askr', terminal_id: sender.id });

    const message = postMessage({
      roomId: room.id, authorHandle: '@askr',
      body: '@you can you confirm the deployment plan?', kind: 'agent'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    const open = listAllOpenAsks().filter((a) => a.targetHandle === '@you');
    expect(open).toHaveLength(1);
    expect(open[0].openedByHandle).toBe('@askr');
    expect(open[0].body).toContain('confirm the deployment');
  });

  it('does NOT open an ask when an agent @-mentions another agent', async () => {
    const { listAllOpenAsks, resetAskStoreForTests } = await import('./askStore');
    resetAskStoreForTests();
    const room = createChatRoom({ name: 'no-ask-agent-target', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@askr' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@askee-agent' });
    const sender = upsertTerminal({ pid: 7002, pid_start: 'p2', name: 'agent-sender' });
    const askee = upsertTerminal({ pid: 7003, pid_start: 'p3', name: 'agent-askee' });
    addMembership({ room_id: room.id, handle: '@askr', terminal_id: sender.id });
    addMembership({ room_id: room.id, handle: '@askee-agent', terminal_id: askee.id });

    const message = postMessage({
      roomId: room.id, authorHandle: '@askr',
      body: '@askee-agent thoughts on slice 5?', kind: 'agent'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    expect(listAllOpenAsks()).toHaveLength(0);
  });

  it('opens ONE ask per (room × askee × message) — idempotent under retried fanout', async () => {
    const { listAllOpenAsks, resetAskStoreForTests } = await import('./askStore');
    resetAskStoreForTests();
    const room = createChatRoom({ name: 'idempotent-open', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@askr' });

    const message = postMessage({
      roomId: room.id, authorHandle: '@askr',
      body: '@you a question worth opening', kind: 'agent'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    fanoutMessageToRoomTerminals(room.id, message);
    fanoutMessageToRoomTerminals(room.id, message);

    expect(listAllOpenAsks().filter((a) => a.targetHandle === '@you')).toHaveLength(1);
  });

  it('skips self-mention (@you posting "@you remember to ...")', async () => {
    const { listAllOpenAsks, resetAskStoreForTests } = await import('./askStore');
    resetAskStoreForTests();
    const room = createChatRoom({ name: 'self-mention', whoCreatedIt: '@you' });
    const message = postMessage({
      roomId: room.id, authorHandle: '@you',
      body: '@you reminder to ship', kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    expect(listAllOpenAsks()).toHaveLength(0);
  });

  it('opens asks for human targets via @-aliases (alias resolves to canonical human handle)', async () => {
    const { listAllOpenAsks, resetAskStoreForTests } = await import('./askStore');
    resetAskStoreForTests();
    const room = createChatRoom({ name: 'alias-to-human', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@askr' });
    setRoomAlias({ roomId: room.id, globalHandle: '@you', newAlias: '@jwpk' });

    const message = postMessage({
      roomId: room.id, authorHandle: '@askr',
      body: '@jwpk a question via your alias', kind: 'agent'
    });
    fanoutMessageToRoomTerminals(room.id, message);

    const open = listAllOpenAsks().filter((a) => a.targetHandle === '@you');
    expect(open).toHaveLength(1);
  });
});

describe('fanoutMessageToRoomTerminals — focus mode (JWPK 2026-06-05)', () => {
  // Focus = a focused member STOPS receiving the room firehose at their
  // terminal; a DIRECT @mention of them still breaks through. Per-member,
  // so focusing @focused never affects @normal. Nothing is lost — the
  // message is in room history regardless; focus only gates the PTY push.
  it('suppresses a broadcast to a FOCUSED member but still delivers to a non-focused member', () => {
    const room = createChatRoom({ name: 'focus-room', whoCreatedIt: '@test' });
    const tSender = upsertTerminal({ pid: 1, pid_start: 'pf1', name: 'focus-sender' });
    const tFocused = upsertTerminal({ pid: 2, pid_start: 'pf2', name: 'focus-focused' });
    const tNormal = upsertTerminal({ pid: 3, pid_start: 'pf3', name: 'focus-normal' });
    updatePaneTarget(tFocused.id, '%focused', 'claude_code');
    updatePaneTarget(tNormal.id, '%normal', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: tSender.id });
    addMembership({ room_id: room.id, handle: '@focused', terminal_id: tFocused.id });
    addMembership({ room_id: room.id, handle: '@normal', terminal_id: tNormal.id });
    // enterFocus validates membership against chatRoomStore.room.members
    // (chat_room_members), a different table than addMembership's
    // room_memberships — the drift R3 is consolidating. Register the focus
    // target in both so the focus check has a member to gate.
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@focused', agentDisplayName: 'Focused' });
    enterFocus({ roomId: room.id, memberHandle: '@focused' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: '@everyone deploy now',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${tFocused.id}`)).toBe(0); // suppressed by focus
    expect(q.pendingCountForTests(`${room.id}::${tNormal.id}`)).toBe(1); // unaffected
  });

  it('SHIELD suppresses even a DIRECT @mention (no live breakthrough — goes to digest)', () => {
    // MVP-2 slice 2 (team-locked, JWPK "make a decision and go"): a mention of a
    // shielded member is NOT delivered live (would be a flood vector); it's
    // captured in the break-bounded exit digest instead. (Reverses the MVP-1
    // mention-breakthrough; flip FOCUS_SHIELD_MENTION_BREAKTHROUGH to restore.)
    const room = createChatRoom({ name: 'focus-mention-room', whoCreatedIt: '@test' });
    const tSender = upsertTerminal({ pid: 4, pid_start: 'pf4', name: 'fm-sender' });
    const tFocused = upsertTerminal({ pid: 5, pid_start: 'pf5', name: 'fm-focused' });
    updatePaneTarget(tFocused.id, '%fmfocused', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: tSender.id });
    addMembership({ room_id: room.id, handle: '@focused', terminal_id: tFocused.id });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@focused', agentDisplayName: 'Focused' });
    enterFocus({ roomId: room.id, memberHandle: '@focused' }); // mode defaults to shield
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: '@focused please look at this',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${tFocused.id}`)).toBe(0); // suppressed; lives in history/digest
  });

  it('SOLO @X mutes everyone else — only the solo target keeps receiving', () => {
    const room = createChatRoom({ name: 'solo-room', whoCreatedIt: '@test' });
    const tSender = upsertTerminal({ pid: 6, pid_start: 'pf6', name: 'solo-sender' });
    const tSolo = upsertTerminal({ pid: 7, pid_start: 'pf7', name: 'solo-target' });
    const tOther = upsertTerminal({ pid: 8, pid_start: 'pf8', name: 'solo-other' });
    updatePaneTarget(tSolo.id, '%solo', 'claude_code');
    updatePaneTarget(tOther.id, '%other', 'claude_code');
    addMembership({ room_id: room.id, handle: '@sender', terminal_id: tSender.id });
    addMembership({ room_id: room.id, handle: '@solo', terminal_id: tSolo.id });
    addMembership({ room_id: room.id, handle: '@other', terminal_id: tOther.id });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@solo', agentDisplayName: 'Solo' });
    enterFocus({ roomId: room.id, memberHandle: '@solo', mode: 'solo' });
    const message = postMessage({
      roomId: room.id,
      authorHandle: '@sender',
      body: '@everyone status?',
      kind: 'human'
    });
    fanoutMessageToRoomTerminals(room.id, message);
    const q = getFanoutQueueForTests();
    expect(q.pendingCountForTests(`${room.id}::${tSolo.id}`)).toBe(1); // solo target still receives
    expect(q.pendingCountForTests(`${room.id}::${tOther.id}`)).toBe(0); // everyone else muted
  });
});

describe('fanoutMessageToRoomTerminals — focus timer prompt (MVP-2 slice 3)', () => {
  it('a lapsed shield fires a ONE-SHOT directed timer prompt to the setter (stays shielded)', async () => {
    const room = createChatRoom({ name: 'timer-prompt', whoCreatedIt: '@you' });
    const tSetter = upsertTerminal({ pid: 9, pid_start: 'pf9', name: 'ts-setter' });
    const tMember = upsertTerminal({ pid: 10, pid_start: 'pf10', name: 'ts-member' });
    updatePaneTarget(tSetter.id, '%tsetter', 'claude_code');
    updatePaneTarget(tMember.id, '%tmember', 'claude_code');
    addMembership({ room_id: room.id, handle: '@setter', terminal_id: tSetter.id });
    addMembership({ room_id: room.id, handle: '@member', terminal_id: tMember.id });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@member', agentDisplayName: 'Member' });
    // @setter shields @member with a 1ms timer.
    enterFocus({ roomId: room.id, memberHandle: '@member', setter: '@setter', durationMs: 1 });
    await new Promise((r) => setTimeout(r, 5));
    const q = getFanoutQueueForTests();
    const before = q.pendingCountForTests(`${room.id}::${tSetter.id}`);
    fireFocusTimerPrompts(room.id);
    expect(q.pendingCountForTests(`${room.id}::${tSetter.id}`)).toBe(before + 1); // setter prompted (directed)
    fireFocusTimerPrompts(room.id);
    expect(q.pendingCountForTests(`${room.id}::${tSetter.id}`)).toBe(before + 1); // one-shot: no double-prompt
  });
});
