import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/rooms/[roomId] load', () => {
  it('redirects unauthenticated room visits to login with a return path', async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: 'Authentication required' }, 401));
    const event = {
      fetch,
      params: { roomId: 'fnokx03pud' }
    } as unknown as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/login?next=%2Frooms%2Ffnokx03pud'
    });
  });

  it('loads room focus mode state', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat-rooms/r_focus') {
        return jsonResponse({
          chatRoom: {
            id: 'r_focus',
            name: 'Focus room',
            summary: null,
            attentionState: null,
            lastUpdate: null,
            whenItWasCreated: '2026-05-16T00:00:00.000Z',
            whoCreatedIt: '@you',
            creationOrder: 1,
            members: [{ handle: '@you', displayName: '@you', displayColor: '#dc2626', displayIcon: 'Y' }]
          }
        });
      }
      if (url === '/api/chat-rooms/r_focus/focus-mode') {
        return jsonResponse({
          focusedMembers: [
            {
              roomId: 'r_focus',
              memberHandle: '@you',
              reason: 'Writing the plan',
              enteredAt: '2026-05-16T10:00:00.000Z',
              expiresAt: null
            }
          ]
        });
      }
      if (url.includes('/messages')) return jsonResponse({ messages: [] });
      if (url.includes('/aliases')) return jsonResponse({ aliases: [] });
      if (url.includes('/agent-events')) return jsonResponse({ agentEvents: [] });
      if (url.includes('/attachments')) return jsonResponse({ sharedFiles: [] });
      if (url.includes('/api/asks')) return jsonResponse({ asks: [] });
      if (url.includes('/plans')) return jsonResponse({ plans: [] });
      if (url.includes('/tasks')) return jsonResponse({ tasks: [] });
      return jsonResponse({}, 404);
    });

    const event = {
      fetch,
      params: { roomId: 'r_focus' }
    } as unknown as Parameters<typeof load>[0];
    const data = await load(event);

    const loaded = data as unknown as { focusedMembers: unknown[] };
    expect(fetch).toHaveBeenCalledWith('/api/chat-rooms/r_focus/focus-mode');
    expect(loaded.focusedMembers).toEqual([
      {
        roomId: 'r_focus',
        memberHandle: '@you',
        reason: 'Writing the plan',
        enteredAt: '2026-05-16T10:00:00.000Z',
        expiresAt: null
      }
    ]);
  });

  it('loads room mode state for heads-down claim UX', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat-rooms/r_heads') {
        return jsonResponse({
          chatRoom: {
            id: 'r_heads',
            name: 'Heads down room',
            summary: null,
            attentionState: null,
            lastUpdate: null,
            whenItWasCreated: '2026-05-21T00:00:00.000Z',
            whoCreatedIt: '@you',
            creationOrder: 1,
            members: [
              {
                handle: '@speedycodex',
                displayName: '@speedycodex',
                displayColor: '#f97316',
                displayIcon: 'C',
                kind: 'agent'
              }
            ]
          }
        });
      }
      if (url === '/api/chat-rooms/r_heads/mode') {
        return jsonResponse({ roomId: 'r_heads', mode: 'heads-down', set_by: '@you', set_at: 123 });
      }
      if (url.includes('/messages')) return jsonResponse({ messages: [] });
      if (url.includes('/aliases')) return jsonResponse({ aliases: [] });
      if (url.includes('/agent-events')) return jsonResponse({ agentEvents: [] });
      if (url.includes('/attachments')) return jsonResponse({ sharedFiles: [] });
      if (url.includes('/api/asks')) return jsonResponse({ asks: [] });
      if (url.includes('/plans')) return jsonResponse({ plans: [] });
      if (url.includes('/tasks')) return jsonResponse({ tasks: [] });
      if (url.includes('/focus-mode')) return jsonResponse({ focusedMembers: [] });
      return jsonResponse({}, 404);
    });

    const event = {
      fetch,
      params: { roomId: 'r_heads' }
    } as unknown as Parameters<typeof load>[0];
    const data = await load(event);

    const loaded = data as unknown as { roomMode: string };
    expect(fetch).toHaveBeenCalledWith('/api/chat-rooms/r_heads/mode');
    expect(loaded.roomMode).toBe('heads-down');
  });

  it('keeps asks, plans, and tasks one-click reachable from the room menu', () => {
    const source = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    expect(source).toContain('class="discipline-links"');
    expect(source).toContain('href={`/asks?roomId=${roomFromServer.id}`}');
    expect(source).toContain('href={primaryRoomPlanHref}');
    expect(source).toContain('href="#tasks"');
  });

  it('threads room mode and roster-based agent identity into message claims', () => {
    const roomPageSource = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    const messageListSource = readFileSync('src/lib/components/MessageList.svelte', 'utf8');
    const messageRowSource = readFileSync('src/lib/components/MessageRow.svelte', 'utf8');

    expect(roomPageSource).toContain('{roomMode}');
    expect(messageListSource).toContain("membersByHandle.get(handle)?.kind === 'agent'");
    expect(messageListSource).toContain('{viewerIsAgent}');
    expect(messageRowSource).not.toContain('@evolveant');
  });
});
