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
      params: { roomId: 'fnokx03pud' },
      url: new URL('http://localhost/rooms/fnokx03pud')
    } as unknown as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/login?next=%2Frooms%2Ffnokx03pud'
    });
  });

  it('preserves room query state when redirecting unauthenticated visits to login', async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: 'Authentication required' }, 401));
    const event = {
      fetch,
      params: { roomId: 'fnokx03pud' },
      url: new URL('http://localhost/rooms/fnokx03pud?panel=tasks&highlight=msg_1')
    } as unknown as Parameters<typeof load>[0];

    await expect(load(event)).rejects.toMatchObject({
      status: 303,
      location: '/login?next=%2Frooms%2Ffnokx03pud%3Fpanel%3Dtasks%26highlight%3Dmsg_1'
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
      params: { roomId: 'r_focus' },
      url: new URL('http://localhost/rooms/r_focus')
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
      params: { roomId: 'r_heads' },
      url: new URL('http://localhost/rooms/r_heads')
    } as unknown as Parameters<typeof load>[0];
    const data = await load(event);

    const loaded = data as unknown as { roomMode: string };
    expect(fetch).toHaveBeenCalledWith('/api/chat-rooms/r_heads/mode');
    expect(loaded.roomMode).toBe('heads-down');
  });

  it('marks room work-surface read failures instead of treating them as empty panels', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat-rooms/r_panels') {
        return jsonResponse({
          chatRoom: {
            id: 'r_panels',
            name: 'Panel room',
            summary: null,
            attentionState: null,
            lastUpdate: null,
            whenItWasCreated: '2026-06-19T00:00:00.000Z',
            whoCreatedIt: '@you',
            creationOrder: 1,
            members: [{ handle: '@you', displayName: '@you', displayColor: '#dc2626', displayIcon: 'Y' }]
          }
        });
      }
      if (url.includes('/messages')) return jsonResponse({ messages: [] });
      if (url.includes('/aliases')) return jsonResponse({ aliases: [] });
      if (url.includes('/agent-events')) return jsonResponse({ agentEvents: [] });
      if (url.includes('/attachments')) return jsonResponse({ sharedFiles: [] });
      if (url.includes('/api/asks')) return jsonResponse({ asks: [] });
      if (url.includes('/plans')) return jsonResponse({ message: 'plans unavailable' }, 500);
      if (url.includes('/tasks')) return jsonResponse({ message: 'tasks unavailable' }, 401);
      if (url.includes('/api/votes')) return jsonResponse({ message: 'votes unavailable' }, 403);
      if (url.includes('/focus-mode')) return jsonResponse({ focusedMembers: [] });
      if (url.includes('/mode')) return jsonResponse({ roomId: 'r_panels', mode: 'brainstorm' });
      if (url.includes('/responders')) return jsonResponse({ responders: [] });
      if (url === '/api/chat-rooms') return jsonResponse({ chatRooms: [] });
      if (url === '/api/capabilities') return jsonResponse({ featureFlags: {}, operatorHandle: '@JWPK' });
      return jsonResponse({}, 404);
    });

    const event = {
      fetch,
      params: { roomId: 'r_panels' },
      url: new URL('http://localhost/rooms/r_panels')
    } as unknown as Parameters<typeof load>[0];
    const data = await load(event);

    expect(data).toMatchObject({
      plansForRoom: [],
      plansFetchFailed: true,
      tasksForRoom: [],
      tasksFetchFailed: true,
      votesForRoom: [],
      votesFetchFailed: true
    });
  });

  it('loads room votes so the menu can show a real vote count before the panel opens', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/chat-rooms/r_votes') {
        return jsonResponse({
          chatRoom: {
            id: 'r_votes',
            name: 'Vote room',
            summary: null,
            attentionState: null,
            lastUpdate: null,
            whenItWasCreated: '2026-06-19T00:00:00.000Z',
            whoCreatedIt: '@you',
            creationOrder: 1,
            members: [{ handle: '@you', displayName: '@you', displayColor: '#dc2626', displayIcon: 'Y' }]
          }
        });
      }
      if (url === '/api/votes?roomId=r_votes') {
        return jsonResponse({
          votes: [
            {
              id: 'vote_1',
              title: 'Ship it?',
              body: null,
              status: 'open',
              state: 'open',
              open: true,
              complete: false,
              eligibleVoters: ['@you'],
              missingVoters: ['@you'],
              roomIds: ['r_votes'],
              options: [],
              ballots: [],
              tally: [],
              createdByHandle: '@you',
              createdAtMs: 1,
              closedByHandle: null,
              closedAtMs: null
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
      if (url.includes('/focus-mode')) return jsonResponse({ focusedMembers: [] });
      if (url.includes('/mode')) return jsonResponse({ roomId: 'r_votes', mode: 'brainstorm' });
      if (url.includes('/responders')) return jsonResponse({ responders: [] });
      if (url === '/api/chat-rooms') return jsonResponse({ chatRooms: [] });
      if (url === '/api/capabilities') return jsonResponse({ featureFlags: {}, operatorHandle: '@JWPK' });
      return jsonResponse({}, 404);
    });

    const event = {
      fetch,
      params: { roomId: 'r_votes' },
      url: new URL('http://localhost/rooms/r_votes')
    } as unknown as Parameters<typeof load>[0];
    const data = await load(event);

    expect(fetch).toHaveBeenCalledWith('/api/votes?roomId=r_votes');
    expect(data).toMatchObject({
      votesFetchFailed: false,
      votesForRoom: [{ id: 'vote_1', title: 'Ship it?' }]
    });
  });

  it('keeps asks, plans, and tasks one-click reachable from the room menu', () => {
    const source = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    expect(source).toContain('class="discipline-links"');
    expect(source).toContain('href={`/asks?roomId=${roomFromServer.id}`}');
    expect(source).toContain('href={primaryRoomPlanHref}');
    expect(source).toContain('href="#tasks"');
  });

  it('threads room work-panel data and fetch failures into dropdown and pinned rail panels', () => {
    const roomPageSource = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    const moreMenuSource = readFileSync('src/lib/components/RoomDetailMoreMenu.svelte', 'utf8');
    const railSource = readFileSync('src/lib/components/RoomDetailContextRail.svelte', 'utf8');

    expect(roomPageSource).toContain('plansFetchFailed');
    expect(roomPageSource).toContain('tasksFetchFailed');
    expect(roomPageSource).toContain('votesFetchFailed');
    expect(moreMenuSource).toContain('<RoomPlansPanel plans={plansForRoom} {plansFetchFailed}');
    expect(moreMenuSource).toContain('<RoomTasksPanel tasks={tasksForRoom} {tasksFetchFailed}');
    expect(moreMenuSource).toContain('count={votesFetchFailed ?');
    expect(moreMenuSource).toContain('<VotesRoomPanel roomId={room.id} initialVotes={votesForRoom} initialFetchFailed={votesFetchFailed}');
    expect(railSource).toContain('<RoomPlansPanel plans={plansForRoom} {plansFetchFailed}');
    expect(railSource).toContain('<RoomTasksPanel tasks={tasksForRoom} {tasksFetchFailed}');
    expect(railSource).toContain('count={votesFetchFailed ?');
    expect(railSource).toContain('<VotesRoomPanel roomId={room.id} initialVotes={votesForRoom} initialFetchFailed={votesFetchFailed}');
  });

  it('surfaces room session failures with a retry action', () => {
    const source = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    expect(source).toContain('browserSessionError');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Retry session');
    expect(source).toContain('onManualRetry={remintBrowserSessionForCurrentRoom}');
  });

  it('surfaces away-mode load and update failures instead of silently showing active', () => {
    const roomPageSource = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    const awayToggleSource = readFileSync('src/lib/components/AwayModeToggle.svelte', 'utf8');
    expect(roomPageSource).toContain('awayTierFetchError');
    expect(roomPageSource).toContain('Away mode could not load');
    expect(roomPageSource).toContain('loadError={awayTierFetchError}');
    expect(awayToggleSource).toContain('visibleError');
    expect(awayToggleSource).toContain('Away mode update failed');
    expect(awayToggleSource).toContain('role="alert"');
  });

  it('preselects the participant when Set focus is opened from the member sheet', () => {
    const roomPageSource = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    expect(roomPageSource).toContain('function openFocusModal(memberHandle: string | null = null)');
    expect(roomPageSource).toContain('focusModalTarget = memberHandle');
    expect(roomPageSource).toContain('openFocusModal(memberHandle)');
    expect(roomPageSource).toContain('preselectedHandle={focusModalTarget}');
    expect(roomPageSource).toContain('onSetFocus={handleSetFocusFromSheet}');
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

  it('wires inline reply drafting from message rows into the room panel', () => {
    const roomPageSource = readFileSync('src/routes/rooms/[roomId]/+page.svelte', 'utf8');
    const messageListSource = readFileSync('src/lib/components/MessageList.svelte', 'utf8');
    const messageRowSource = readFileSync('src/lib/components/MessageRow.svelte', 'utf8');
    const messageHeaderSource = readFileSync('src/lib/components/MessageRowHeader.svelte', 'utf8');

    expect(messageHeaderSource).toContain('Reply in line');
    expect(messageRowSource).toContain('onInlineReplyRequested');
    expect(messageListSource).toContain('onInlineReplyRequested');
    expect(roomPageSource).toContain('InlineReplyComposer');
    expect(roomPageSource).toContain('setInlineReplyTarget');
  });
});
