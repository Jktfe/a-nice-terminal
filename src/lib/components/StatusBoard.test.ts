import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import StatusBoard from './StatusBoard.svelte';
import type { VoteView } from '$lib/server/voteStore';

// A status board is a vote with status-state options + agent participants.
const BOARD: VoteView = {
  id: 'status_1',
  title: 'Research complete?',
  body: 'Mark your state on the milestone.',
  status: 'open',
  state: 'open',
  open: true,
  complete: false,
  createdByHandle: '@chair',
  createdAtMs: 1,
  closedByHandle: null,
  closedAtMs: null,
  roomIds: ['room_alpha'],
  eligibleVoters: ['@alpha', '@beta', '@gamma', '@delta'],
  missingVoters: ['@gamma', '@delta'],
  options: [
    { id: 'opt_complete', label: 'complete', sortOrder: 0 },
    { id: 'opt_progress', label: 'in progress', sortOrder: 1 },
    { id: 'opt_stuck', label: 'stuck', sortOrder: 2 },
    { id: 'opt_blocked', label: 'blocked', sortOrder: 3 }
  ],
  ballots: [
    { voterHandle: '@alpha', optionId: 'opt_complete', optionLabel: 'complete', roomId: 'room_alpha', reason: null, castAtMs: 2 },
    { voterHandle: '@beta', optionId: 'opt_progress', optionLabel: 'in progress', roomId: 'room_alpha', reason: null, castAtMs: 3 }
  ],
  tally: [
    { optionId: 'opt_complete', label: 'complete', count: 1 },
    { optionId: 'opt_progress', label: 'in progress', count: 1 },
    { optionId: 'opt_stuck', label: 'stuck', count: 0 },
    { optionId: 'opt_blocked', label: 'blocked', count: 0 }
  ]
};

describe('StatusBoard', () => {
  it('renders the milestone title and every state', () => {
    const { body } = render(StatusBoard, {
      props: { boardId: 'status_1', roomId: 'room_alpha', initialBoard: BOARD }
    });
    expect(body).toContain('Research complete?');
    expect(body).toContain('complete');
    expect(body).toContain('in progress');
    expect(body).toContain('stuck');
    expect(body).toContain('blocked');
  });

  it('shows which agents are in each state', () => {
    const { body } = render(StatusBoard, {
      props: { boardId: 'status_1', roomId: 'room_alpha', initialBoard: BOARD }
    });
    expect(body).toContain('@alpha'); // in complete
    expect(body).toContain('@beta'); // in progress
  });

  it('reports progress as reported / participants + pending', () => {
    const { body } = render(StatusBoard, {
      props: { boardId: 'status_1', roomId: 'room_alpha', initialBoard: BOARD }
    });
    expect(body).toContain('2 of 4 reported');
    expect(body).toContain('2 pending');
  });

  it('marks the viewer\'s own state', () => {
    const { body } = render(StatusBoard, {
      props: { boardId: 'status_1', roomId: 'room_alpha', asHandle: '@alpha', initialBoard: BOARD }
    });
    expect(body).toContain('✓ me');
  });

  it('offers a set-status control when open, none when closed', () => {
    const open = render(StatusBoard, {
      props: { boardId: 'status_1', roomId: 'room_alpha', initialBoard: BOARD }
    });
    expect(open.body).toContain('this is me');

    const closed = render(StatusBoard, {
      props: {
        boardId: 'status_1',
        roomId: 'room_alpha',
        initialBoard: { ...BOARD, state: 'closed', status: 'closed', open: false }
      }
    });
    expect(closed.body).not.toContain('this is me');
  });

  it('renders no board markup without data (pre-fetch)', () => {
    const { body } = render(StatusBoard, {
      props: { boardId: 'status_1', roomId: 'room_alpha' }
    });
    expect(body).not.toContain('class="board"');
  });
});
