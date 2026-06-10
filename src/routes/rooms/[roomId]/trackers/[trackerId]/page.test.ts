import { describe, expect, it } from 'vitest';
import { load } from './+page';

describe('/rooms/[roomId]/trackers/[trackerId] load', () => {
  it('loads the live tracker through the room-scoped tracker API', async () => {
    const calls: string[] = [];
    const fetch = async (url: string) => {
      calls.push(url);
      return new Response(JSON.stringify({
        tracker: {
          id: 'trk_gvpl4',
          roomId: 'room-a',
          title: 'GVPL4 test',
          columns: [{ key: 'beneficiary', label: 'Beneficiary', type: 'text' }],
          rows: [],
          events: []
        }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };

    const data = await load({
      fetch: fetch as never,
      params: { roomId: 'room-a', trackerId: 'trk_gvpl4' }
    } as never);

    expect(calls).toEqual(['/api/chat-rooms/room-a/trackers/trk_gvpl4']);
    expect(data).toMatchObject({
      roomId: 'room-a',
      trackerId: 'trk_gvpl4',
      tracker: { id: 'trk_gvpl4', title: 'GVPL4 test' }
    });
  });

  it('turns a missing tracker API response into the standalone page 404', async () => {
    const fetch = async () => new Response('not found', { status: 404 });

    await expect(load({
      fetch: fetch as never,
      params: { roomId: 'room-a', trackerId: 'missing' }
    } as never)).rejects.toMatchObject({ status: 404 });
  });
});
