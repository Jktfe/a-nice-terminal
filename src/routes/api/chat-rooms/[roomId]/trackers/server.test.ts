import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { POST as createPost, GET as listGet } from './+server';
import { GET as viewGet } from './[trackerId]/+server';
import { POST as rowPost } from './[trackerId]/rows/+server';
import { PATCH as cellPatch } from './[trackerId]/rows/[rowId]/+server';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { resetTrackerStoreForTests } from '$lib/server/trackerStore';
import { listMessagesInRoom, resetChatMessageStoreForTests } from '$lib/server/chatMessageStore';
import { listArtefactsInRoom, resetChatRoomArtefactStoreForTests } from '$lib/server/chatRoomArtefactStore';
import { subscribeRoomEvents } from '$lib/server/eventBroadcast';

const ADMIN = 'tracker-route-admin-token';
const ORIG = process.env.ANT_ADMIN_TOKEN;
beforeAll(() => { process.env.ANT_ADMIN_TOKEN = ADMIN; });
afterAll(() => { if (ORIG === undefined) delete process.env.ANT_ADMIN_TOKEN; else process.env.ANT_ADMIN_TOKEN = ORIG; });

type AnyEvent = Parameters<typeof createPost>[0];
function ev(params: Record<string,string>, body?: unknown): AnyEvent {
  const headers: Record<string,string> = { authorization: `Bearer ${ADMIN}` };
  if (body !== undefined) headers['content-type'] = 'application/json';
  const url = new URL('http://localhost/api/chat-rooms/x/trackers');
  return { request: new Request(url.toString(), { method: 'POST', headers, body: body!==undefined?JSON.stringify(body):undefined }), params, url } as unknown as AnyEvent;
}
const H = (h: unknown) => h as (e: AnyEvent) => unknown;
async function run(h: (e: AnyEvent)=>unknown, e: AnyEvent): Promise<Response> {
  try { return (await h(e)) as Response; }
  catch (x) { if (x instanceof Response) return x; const f = x as {status?:number;body?:unknown}; if (typeof f?.status==='number') return new Response(JSON.stringify(f.body??{}),{status:f.status}); throw x; }
}

describe('tracker API', () => {
  beforeEach(() => { resetChatRoomStoreForTests(); resetChatMessageStoreForTests(); resetTrackerStoreForTests(); resetChatRoomArtefactStoreForTests(); });

  it('create → add row → set cell, with audit chat-events + store events', async () => {
    const room = createChatRoom({ name: 'gvpl4', whoCreatedIt: '@you' });
    const liveEvents: Record<string, unknown>[] = [];
    const unsubscribe = subscribeRoomEvents(room.id, (event) => liveEvents.push(event));
    try {
      const created = await run(H(createPost), ev({ roomId: room.id }, {
        roomId: room.id, title: 'GVPL4 payments',
        columnSpec: 'Beneficiary, Quantum(£), Invoice link(link), Due date(date), Paid(y/n), Date paid(date)'
      }));
      expect(created.status).toBe(201);
      const t = (await created.json()).tracker;
      expect(t.columns.map((c:{key:string})=>c.key)).toContain('paid');
      // create-receipt posted with ant-tracker fence
      expect(listMessagesInRoom(room.id).some(m => m.body.includes('```ant-tracker') && m.body.includes(t.id))).toBe(true);
      expect(liveEvents.filter((event) => event.type === 'message_added')).toHaveLength(1);
      // JWPK msg_g4ttgnn65i: tracker auto-registers as a room artefact (findable without scrolling)
      const arts = listArtefactsInRoom(room.id).filter(a => a.kind === 'tracker');
      expect(arts).toHaveLength(1);
      expect(arts[0].title).toBe('GVPL4 payments');
      expect(arts[0].refUrl).toBe(`/rooms/${room.id}/trackers/${t.id}`);

      const rowRes = await run(H(rowPost), ev({ roomId: room.id, trackerId: t.id }, {
        roomId: room.id, cells: { beneficiary: 'Acme Ltd', quantum: '12500', paid: '' }
      }));
      expect(rowRes.status).toBe(201);
      const rowId = (await rowRes.json()).row.id;
      expect(liveEvents.filter((event) => event.type === 'message_added')).toHaveLength(2);

      const setRes = await run(H(cellPatch), ev({ roomId: room.id, trackerId: t.id, rowId }, {
        roomId: room.id, columnKey: 'paid', value: 'true'
      }));
      expect(setRes.status).toBe(200);
      expect((await setRes.json()).row.cells.paid).toBe('true');
      expect(liveEvents.filter((event) => event.type === 'message_added')).toHaveLength(3);

      const view = await run(H(viewGet), ev({ roomId: room.id, trackerId: t.id }));
      const v = (await view.json()).tracker;
      expect(v.rows).toHaveLength(1);
      expect(v.events.filter((e:{kind:string})=>e.kind==='cell.set')).toHaveLength(1);
      // cell-set audit chat event carries old→new
      expect(listMessagesInRoom(room.id).some(m => m.body.includes('Paid') && m.body.includes('→'))).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it('a no-op cell write posts no audit event', async () => {
    const room = createChatRoom({ name: 'r', whoCreatedIt: '@you' });
    const t = (await (await run(H(createPost), ev({ roomId: room.id }, { roomId: room.id, title: 'T', columnSpec: 'A' }))).json()).tracker;
    const rowId = (await (await run(H(rowPost), ev({ roomId: room.id, trackerId: t.id }, { roomId: room.id, cells: { a: 'x' } }))).json()).row.id;
    const before = listMessagesInRoom(room.id).length;
    await run(H(cellPatch), ev({ roomId: room.id, trackerId: t.id, rowId }, { roomId: room.id, columnKey: 'a', value: 'x' }));
    expect(listMessagesInRoom(room.id).length).toBe(before);
  });

  it('view 404s for a tracker from another room', async () => {
    const a = createChatRoom({ name: 'a', whoCreatedIt: '@you' });
    const b = createChatRoom({ name: 'b', whoCreatedIt: '@you' });
    const t = (await (await run(H(createPost), ev({ roomId: a.id }, { roomId: a.id, title: 'T', columnSpec: 'A' }))).json()).tracker;
    const res = await run(H(viewGet), ev({ roomId: b.id, trackerId: t.id }));
    expect(res.status).toBe(404);
  });
});
