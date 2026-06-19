import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probeTmuxSocketBindingMock = vi.fn();
(globalThis as unknown as { __probeTmuxSocketBindingMock: typeof probeTmuxSocketBindingMock }).__probeTmuxSocketBindingMock =
  probeTmuxSocketBindingMock;

type MockTerminalRecord = {
  session_id: string;
  name: string;
  auto_forward_room_id: string | null;
  auto_forward_chat: number;
  agent_kind: string | null;
  tmux_target_pane: string | null;
  linked_chat_room_id: string | null;
  created_by: string | null;
  allowlist: string | null;
  handle: string | null;
  boot_command: string | null;
};

type MockState = {
  records: Map<string, MockTerminalRecord>;
  terminals: Map<string, { id: string; pid: number; pid_start: string | null; expires_at: number | null; meta: string }>;
  rooms: Set<string>;
  softDeletedRooms: Set<string>;
  failLinkedRoomUpdate: boolean;
  handles: Map<string, { owners: string[]; binding: { pane: string | null; pid: number | null; terminalId: string | null } | null }>;
};

const mockState: MockState = {
  records: new Map(),
  terminals: new Map(),
  rooms: new Set(),
  softDeletedRooms: new Set(),
  failLinkedRoomUpdate: false,
  handles: new Map()
};

(globalThis as unknown as { __adoptLocalState: MockState }).__adoptLocalState = mockState;

function state(): MockState {
  return (globalThis as unknown as { __adoptLocalState: MockState }).__adoptLocalState;
}

vi.mock('$lib/server/terminalSocketMetadata', () => ({
  probeTmuxSocketBinding: (...args: unknown[]) =>
    (globalThis as unknown as { __probeTmuxSocketBindingMock: typeof probeTmuxSocketBindingMock })
      .__probeTmuxSocketBindingMock(...args)
}));

vi.mock('$lib/server/chatRoomAuthGate', () => ({
  tryAdminBearer: (request: Request) => request.headers.get('authorization') === 'Bearer admin-token',
  tryOperatorSession: () => false,
  tryAntchatOperatorBearer: () => false
}));

vi.mock('$lib/server/chatRoomStore', () => ({
  createChatRoom: ({ name }: { name: string }) => {
    const id = `room-${state().rooms.size + 1}`;
    state().rooms.add(id);
    return { id, name };
  },
  findChatRoomById: (id: string) => state().rooms.has(id) ? { id, name: id } : null,
  softDeleteChatRoom: (id: string) => {
    state().softDeletedRooms.add(id);
    state().rooms.delete(id);
    return true;
  }
}));

vi.mock('$lib/server/terminalRecordsStore', () => ({
  getTerminalRecord: (sessionId: string) => state().records.get(sessionId) ?? null,
  createTerminalRecord: (input: {
    sessionId: string;
    name?: string;
    createdBy?: string | null;
    handle?: string | null;
    tmuxTargetPane?: string | null;
  }) => {
    const record: MockTerminalRecord = {
      session_id: input.sessionId,
      name: input.name ?? input.sessionId,
      auto_forward_room_id: null,
      auto_forward_chat: 1,
      agent_kind: null,
      tmux_target_pane: input.tmuxTargetPane ?? `${input.sessionId}:0.0`,
      linked_chat_room_id: null,
      created_by: input.createdBy ?? null,
      allowlist: null,
      handle: input.handle ?? null,
      boot_command: null
    };
    state().records.set(input.sessionId, record);
    return record;
  },
  updateTerminalRecord: (sessionId: string, patch: Record<string, unknown>) => {
    const record = state().records.get(sessionId);
    if (!record) return null;
    if ('linkedChatRoomId' in patch && state().failLinkedRoomUpdate) return null;
    if ('linkedChatRoomId' in patch) record.linked_chat_room_id = patch.linkedChatRoomId as string | null;
    if ('createdBy' in patch) record.created_by = patch.createdBy as string | null;
    if ('handle' in patch) record.handle = patch.handle as string | null;
    if ('tmuxTargetPane' in patch) record.tmux_target_pane = patch.tmuxTargetPane as string | null;
    return record;
  },
  parseAllowlist: () => null,
  deriveHandle: (record: MockTerminalRecord) => record.handle ?? `@${record.name.toLowerCase()}`
}));

vi.mock('$lib/server/terminalsStore', () => ({
  getTerminalById: (id: string) => state().terminals.get(id) ?? null,
  adoptExternalProcessForTerminal: (input: {
    record: MockTerminalRecord;
    pid: number;
    pidStart: string | null;
    ttlSeconds: number | null;
    meta?: Record<string, unknown>;
  }) => {
    const row = {
      id: input.record.session_id,
      pid: input.pid,
      pid_start: input.pidStart,
      expires_at: input.ttlSeconds === null ? null : 123,
      meta: JSON.stringify({
        origin: 'adopt',
        ...(input.meta ?? {})
      })
    };
    state().terminals.set(row.id, row);
    return row;
  }
}));

vi.mock('$lib/server/handleBindingsStore', () => ({
  bindHandle: (input: {
    handle: string;
    pane: string | null;
    pid: number | null;
    terminalId?: string | null;
  }) => {
    const current = state().handles.get(input.handle) ?? { owners: [], binding: null };
    current.binding = {
      pane: input.pane,
      pid: input.pid,
      terminalId: input.terminalId ?? null
    };
    state().handles.set(input.handle, current);
    return current.binding;
  },
  ensureHandleOwnedBy: (handle: string, owner: string) => {
    const current = state().handles.get(handle) ?? { owners: [], binding: null };
    if (!current.owners.includes(owner)) current.owners.push(owner);
    state().handles.set(handle, current);
    return { handle, owners: current.owners };
  }
}));

import { POST as adoptLocalPost } from './+server';
import { getTerminalRecord } from '$lib/server/terminalRecordsStore';
import { getTerminalById } from '$lib/server/terminalsStore';

const previousAdminToken = process.env.ANT_ADMIN_TOKEN;

type AnyHandler = (event: unknown) => unknown;

function eventFor(body: Record<string, unknown>, token = 'admin-token'): unknown {
  const request = new Request('http://localhost/api/terminals/adopt-local', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  return { request, params: {}, url: new URL(request.url) };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return await handler(event) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('POST /api/terminals/adopt-local', () => {
  beforeEach(() => {
    process.env.ANT_ADMIN_TOKEN = 'admin-token';
    mockState.records.clear();
    mockState.terminals.clear();
    mockState.rooms.clear();
    mockState.softDeletedRooms.clear();
    mockState.failLinkedRoomUpdate = false;
    mockState.handles.clear();
    probeTmuxSocketBindingMock.mockReset();
  });

  afterEach(() => {
    if (previousAdminToken === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = previousAdminToken;
  });

  it('creates a terminal record and socket-backed terminal row without spawning a new tmux session', async () => {
    probeTmuxSocketBindingMock.mockReturnValue({
      pid: 57134,
      pidStart: 'Tue Jun 16 10:14:11 2026',
      tmuxSessionName: 'antos-term 2',
      tmuxTargetPane: '%10',
      paneTitle: 'anTERM'
    });

    const response = await runHandler(adoptLocalPost as unknown as AnyHandler, eventFor({
      sessionId: 'antos-term-2',
      name: 'anTERM',
      handle: '@anterm',
      user: '@JWPK',
      tmuxSocketPath: '/Users/james/.tmux-antos/default',
      tmuxSessionName: 'antos-term 2'
    }));

    expect(response.status).toBe(201);
    const payload = await response.json();
    expect(payload.sessionId).toBe('antos-term-2');
    expect(payload.tmuxSocketPath).toBe('/Users/james/.tmux-antos/default');
    expect(payload.tmuxSessionName).toBe('antos-term 2');
    expect(payload.alive).toBe(true);

    const record = getTerminalRecord('antos-term-2');
    expect(record?.name).toBe('anTERM');
    expect(record?.handle).toBe('@anterm');
    expect(record?.tmux_target_pane).toBe('%10');
    expect(record?.linked_chat_room_id).toBeTruthy();

    const terminal = getTerminalById('antos-term-2');
    expect(terminal?.pid).toBe(57134);
    expect(terminal?.expires_at).toBeNull();
    expect(JSON.parse(terminal?.meta ?? '{}')).toMatchObject({
      origin: 'antos-local-adopt',
      tmuxSocketPath: '/Users/james/.tmux-antos/default',
      tmuxSessionName: 'antos-term 2',
      tmuxTargetPane: '%10',
      paneTitle: 'anTERM'
    });

    expect(mockState.handles.get('@anterm')).toMatchObject({
      owners: ['@JWPK'],
      binding: {
        pane: '%10',
        pid: 57134,
        terminalId: 'antos-term-2'
      }
    });
  });

  it('requires operator/admin auth', async () => {
    const response = await runHandler(adoptLocalPost as unknown as AnyHandler, eventFor({
      name: 'anTERM',
      handle: '@anterm',
      tmuxSocketPath: '/Users/james/.tmux-antos/default',
      tmuxSessionName: 'antos-term 2'
    }, 'wrong-token'));

    expect(response.status).toBe(401);
  });

  it('rolls back a just-created linked room when the terminal record cannot be linked', async () => {
    probeTmuxSocketBindingMock.mockReturnValue({
      pid: 57135,
      pidStart: 'Tue Jun 16 10:15:11 2026',
      tmuxSessionName: 'broken-link',
      tmuxTargetPane: '%11',
      paneTitle: 'broken'
    });
    mockState.failLinkedRoomUpdate = true;

    const response = await runHandler(adoptLocalPost as unknown as AnyHandler, eventFor({
      sessionId: 'broken-link',
      name: 'Broken Link',
      handle: '@brokenlink',
      user: '@JWPK',
      tmuxSocketPath: '/Users/james/.tmux-antos/default',
      tmuxSessionName: 'broken-link'
    }));

    expect(response.status).toBe(500);
    expect(mockState.softDeletedRooms.has('room-1')).toBe(true);
    expect(mockState.rooms.has('room-1')).toBe(false);
    expect(getTerminalRecord('broken-link')?.linked_chat_room_id).toBeNull();
  });
});
