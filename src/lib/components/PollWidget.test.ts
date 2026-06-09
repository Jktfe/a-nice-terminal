import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import PollWidget from './PollWidget.svelte';
import type { VoteView } from '$lib/server/voteStore';

const VOTE: VoteView = {
  id: 'vote_1',
  title: 'Ship the inline poll?',
  body: 'Render polls in-thread like tables.',
  status: 'open',
  state: 'open',
  open: true,
  complete: false,
  createdByHandle: '@convener',
  createdAtMs: 1,
  closedByHandle: null,
  closedAtMs: null,
  roomIds: ['room_alpha'],
  eligibleVoters: ['@a', '@b', '@c'],
  missingVoters: ['@c'],
  options: [
    { id: 'opt_yes', label: 'Yes', sortOrder: 0 },
    { id: 'opt_no', label: 'No', sortOrder: 1 }
  ],
  ballots: [
    { voterHandle: '@a', optionId: 'opt_yes', optionLabel: 'Yes', roomId: 'room_alpha', reason: null, castAtMs: 2 },
    { voterHandle: '@b', optionId: 'opt_yes', optionLabel: 'Yes', roomId: 'room_alpha', reason: null, castAtMs: 3 }
  ],
  tally: [
    { optionId: 'opt_yes', label: 'Yes', count: 2 },
    { optionId: 'opt_no', label: 'No', count: 0 }
  ]
};

describe('PollWidget', () => {
  it('renders title, state, options and the per-option counts', () => {
    const { body } = render(PollWidget, {
      props: { voteId: 'vote_1', roomId: 'room_alpha', initialVote: VOTE }
    });
    expect(body).toContain('Ship the inline poll?');
    expect(body).toContain('Open');
    expect(body).toContain('Yes');
    expect(body).toContain('No');
    expect(body).toContain('2 votes');
    expect(body).toContain('no votes yet');
  });

  it('shows WHO voted (voter handles) under each option', () => {
    const { body } = render(PollWidget, {
      props: { voteId: 'vote_1', roomId: 'room_alpha', initialVote: VOTE }
    });
    expect(body).toContain('@a');
    expect(body).toContain('@b');
  });

  it('reports turnout and missing voters', () => {
    const { body } = render(PollWidget, {
      props: { voteId: 'vote_1', roomId: 'room_alpha', initialVote: VOTE }
    });
    expect(body).toContain('2 of 3 voted');
    expect(body).toContain('1 missing');
  });

  it('marks the option the viewer already chose', () => {
    const { body } = render(PollWidget, {
      props: { voteId: 'vote_1', roomId: 'room_alpha', asHandle: '@a', initialVote: VOTE }
    });
    expect(body).toContain('✓ you');
  });

  it('renders no poll content without a vote (pre-fetch, no SSR seed)', () => {
    const { body } = render(PollWidget, {
      props: { voteId: 'vote_1', roomId: 'room_alpha' }
    });
    // Svelte SSR still emits empty hydration-comment markers for the {#if};
    // what matters is that no poll markup is produced before data arrives.
    expect(body).not.toContain('class="poll"');
    expect(body).not.toContain('Refresh');
  });

  it('offers a cast control on an open vote but not a closed one', () => {
    const open = render(PollWidget, {
      props: { voteId: 'vote_1', roomId: 'room_alpha', initialVote: VOTE }
    });
    expect(open.body).toContain('Vote');

    const closed = render(PollWidget, {
      props: {
        voteId: 'vote_1',
        roomId: 'room_alpha',
        initialVote: { ...VOTE, state: 'closed', status: 'closed', open: false }
      }
    });
    expect(closed.body).not.toContain('>Vote<');
  });
});
