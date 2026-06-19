import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import VotesRoomPanel from './VotesRoomPanel.svelte';

describe('VotesRoomPanel', () => {
  it('renders vote state, tally, missing voters, and cast command guidance', () => {
    const { body } = render(VotesRoomPanel, {
      props: {
        roomId: 'room_alpha',
        initialVotes: [
          {
            id: 'vote_1',
            title: 'Choose delivery route',
            body: 'Pick the path the room should follow.',
            state: 'open',
            open: true,
            complete: false,
            status: 'open',
            eligibleVoters: ['@a', '@b'],
            missingVoters: ['@b'],
            roomIds: ['room_alpha', 'room_beta'],
            options: [
              { id: 'opt_yes', label: 'Yes', sortOrder: 0 },
              { id: 'opt_no', label: 'No', sortOrder: 1 }
            ],
            tally: [
              { optionId: 'opt_yes', label: 'Yes', count: 1 },
              { optionId: 'opt_no', label: 'No', count: 0 }
            ],
            ballots: [],
            createdByHandle: '@convener',
            createdAtMs: 1,
            closedByHandle: null,
            closedAtMs: null
          }
        ]
      }
    });

    expect(body).toContain('Choose delivery route');
    expect(body).toContain('Open');
    expect(body).toContain('Yes');
    expect(body).toContain('1 vote');
    expect(body).toContain('@b');
    expect(body).toContain('ant vote cast vote_1 --room room_alpha --option opt_yes');
    expect(body).toContain('2 rooms');
  });

  it('renders a quiet empty state when there are no votes', () => {
    const { body } = render(VotesRoomPanel, {
      props: { roomId: 'room_alpha', initialVotes: [] }
    });

    expect(body).toContain('No votes in this room yet.');
    expect(body).toContain('ant vote create --room room_alpha');
  });

  it('does not treat vote auth or room-read failures as an empty vote list', () => {
    const source = readFileSync('src/lib/components/VotesRoomPanel.svelte', 'utf8');
    expect(source).toContain('response.status === 401 || response.status === 403 || response.status === 404');
    expect(source).toContain('Could not load votes for this room. Try refreshing in a moment.');
    expect(source).not.toContain('liveVotes = [];\n        return;');
  });

  it('renders a seeded fetch failure before the client retry runs', () => {
    const { body } = render(VotesRoomPanel, {
      props: { roomId: 'room_alpha', initialVotes: [], initialFetchFailed: true }
    });

    expect(body).toContain('Could not load votes for this room. Try refreshing in a moment.');
    expect(body).not.toContain('No votes in this room yet.');
  });
});
