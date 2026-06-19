import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST } from './+server';
import { PATCH } from './[rowId]/+server';
import {
  createChatRoom,
  resetChatRoomStoreForTests
} from '$lib/server/chatRoomStore';
import {
  addRow,
  createTracker,
  getTrackerView,
  resetTrackerStoreForTests
} from '$lib/server/trackerStore';
import {
  listMessagesInRoom,
  resetChatMessageStoreForTests
} from '$lib/server/chatMessageStore';
import { resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';

const ADMIN = 'tracker-row-route-admin-token';
const ORIGINAL_ADMIN = process.env.ANT_ADMIN_TOKEN;

beforeAll(() => {
  process.env.ANT_ADMIN_TOKEN = ADMIN;
});

afterAll(() => {
  if (ORIGINAL_ADMIN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = ORIGINAL_ADMIN;
});

type RowPostEvent = Parameters<typeof POST>[0];
type RowPatchEvent = Parameters<typeof PATCH>[0];
type AnyHandler = (event: unknown) => unknown;

beforeEach(() => {
  resetChatRoomStoreForTests();
  resetChatMessageStoreForTests();
  resetTrackerStoreForTests();
  resetChatRoomArtefactStoreForTests();
});

function routeEvent(
  method: 'POST' | 'PATCH',
  params: { roomId: string; trackerId: string; rowId?: string },
  body?: unknown,
  withAuth = true
): RowPostEvent | RowPatchEvent {
  const rowPath = params.rowId ? `/rows/${encodeURIComponent(params.rowId)}` : '/rows';
  const url = new URL(
    `http://localhost/api/chat-rooms/${encodeURIComponent(params.roomId)}/trackers/${encodeURIComponent(params.trackerId)}${rowPath}`
  );
  const headers: Record<string, string> = {};
  if (withAuth) headers.authorization = `Bearer ${ADMIN}`;
  const init: RequestInit = { method, headers };
  if (body !== undefined) {
    headers['content-type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(url, init),
    params: {
      roomId: params.roomId,
      trackerId: params.trackerId,
      rowId: params.rowId ?? ''
    },
    url
  } as RowPostEvent | RowPatchEvent;
}

async function run(handler: AnyHandler, event: RowPostEvent | RowPatchEvent): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

function seedTracker() {
  const room = createChatRoom({ name: 'tracker-rows', whoCreatedIt: '@you' });
  const tracker = createTracker({
    roomId: room.id,
    title: 'Payments',
    columns: [
      { label: 'Payee' },
      { label: 'Paid', type: 'bool' }
    ],
    createdByHandle: '@you'
  });
  return { room, tracker };
}

describe('/api/chat-rooms/:roomId/trackers/:trackerId/rows', () => {
  it('POST creates a row for the room tracker and ignores unknown cells', async () => {
    const { room, tracker } = seedTracker();

    const response = await run(POST as unknown as AnyHandler, routeEvent('POST', {
      roomId: room.id,
      trackerId: tracker.id
    }, {
      cells: {
        payee: 'Acme',
        paid: true,
        not_a_column: 'discarded'
      }
    }));

    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.row).toMatchObject({
      tableId: tracker.id,
      cells: {
        payee: 'Acme',
        paid: 'true'
      },
      createdByHandle: '@admin'
    });
    expect(body.row.cells).not.toHaveProperty('not_a_column');
    expect(getTrackerView(tracker.id)?.events.map((event) => event.kind)).toEqual(['row.add']);
    expect(listMessagesInRoom(room.id).some((message) => message.body.includes('added a row to Payments'))).toBe(true);
  });

  it('POST returns 404 when the tracker belongs to a different room', async () => {
    const { tracker } = seedTracker();
    const other = createChatRoom({ name: 'other-room', whoCreatedIt: '@you' });

    const response = await run(POST as unknown as AnyHandler, routeEvent('POST', {
      roomId: other.id,
      trackerId: tracker.id
    }, {
      cells: { payee: 'Wrong room' }
    }));

    expect(response.status).toBe(404);
    expect(getTrackerView(tracker.id)?.rows).toEqual([]);
  });

  it('POST requires mutation auth before writing', async () => {
    const { room, tracker } = seedTracker();

    const response = await run(POST as unknown as AnyHandler, routeEvent('POST', {
      roomId: room.id,
      trackerId: tracker.id
    }, {
      cells: { payee: 'No auth' }
    }, false));

    expect(response.status).toBe(401);
    expect(getTrackerView(tracker.id)?.rows).toEqual([]);
  });
});

describe('/api/chat-rooms/:roomId/trackers/:trackerId/rows/:rowId', () => {
  it('PATCH updates one known cell and appends one cell-set event', async () => {
    const { room, tracker } = seedTracker();
    const row = addRow({ tableId: tracker.id, cells: { payee: 'Acme', paid: '' }, byHandle: '@you' });
    if (!row) throw new Error('Failed to seed tracker row');

    const response = await run(PATCH as unknown as AnyHandler, routeEvent('PATCH', {
      roomId: room.id,
      trackerId: tracker.id,
      rowId: row.id
    }, {
      columnKey: 'paid',
      value: 'yes'
    }));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.row.cells.paid).toBe('yes');
    expect(getTrackerView(tracker.id)?.events.map((event) => event.kind)).toEqual([
      'row.add',
      'cell.set'
    ]);
    expect(listMessagesInRoom(room.id).some((message) => message.body.includes('Paid'))).toBe(true);
  });

  it('PATCH rejects an unknown column without changing the row', async () => {
    const { room, tracker } = seedTracker();
    const row = addRow({ tableId: tracker.id, cells: { payee: 'Acme', paid: '' }, byHandle: '@you' });
    if (!row) throw new Error('Failed to seed tracker row');

    const response = await run(PATCH as unknown as AnyHandler, routeEvent('PATCH', {
      roomId: room.id,
      trackerId: tracker.id,
      rowId: row.id
    }, {
      columnKey: 'missing',
      value: 'new'
    }));

    expect(response.status).toBe(400);
    expect(getTrackerView(tracker.id)?.rows[0].cells).toMatchObject({ payee: 'Acme', paid: '' });
    expect(getTrackerView(tracker.id)?.events.map((event) => event.kind)).toEqual(['row.add']);
  });

  it('PATCH returns 404 when the row belongs to a different tracker', async () => {
    const { room, tracker } = seedTracker();
    const otherTracker = createTracker({
      roomId: room.id,
      title: 'Other tracker',
      columns: [{ label: 'Payee' }],
      createdByHandle: '@you'
    });
    const otherRow = addRow({ tableId: otherTracker.id, cells: { payee: 'Other' }, byHandle: '@you' });
    if (!otherRow) throw new Error('Failed to seed other tracker row');

    const response = await run(PATCH as unknown as AnyHandler, routeEvent('PATCH', {
      roomId: room.id,
      trackerId: tracker.id,
      rowId: otherRow.id
    }, {
      columnKey: 'payee',
      value: 'Moved'
    }));

    expect(response.status).toBe(404);
    expect(getTrackerView(otherTracker.id)?.rows[0].cells.payee).toBe('Other');
  });

  it('PATCH requires mutation auth before editing', async () => {
    const { room, tracker } = seedTracker();
    const row = addRow({ tableId: tracker.id, cells: { payee: 'Acme', paid: '' }, byHandle: '@you' });
    if (!row) throw new Error('Failed to seed tracker row');

    const response = await run(PATCH as unknown as AnyHandler, routeEvent('PATCH', {
      roomId: room.id,
      trackerId: tracker.id,
      rowId: row.id
    }, {
      columnKey: 'paid',
      value: 'yes'
    }, false));

    expect(response.status).toBe(401);
    expect(getTrackerView(tracker.id)?.rows[0].cells.paid).toBe('');
  });
});
