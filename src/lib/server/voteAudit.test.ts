import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { resetIdentityDbForTests } from './db';
import { createVote, castVoteBallot, getVoteBallotHistory, resetVoteStoreSchemaForTests } from './voteStore';

beforeEach(() => { process.env.ANT_FRESH_DB_PATH = ':memory:'; resetIdentityDbForTests(); resetVoteStoreSchemaForTests(); });
afterEach(() => { resetIdentityDbForTests(); delete process.env.ANT_FRESH_DB_PATH; });

const mk = () => createVote({ title: 'Route', options: ['Yes', 'No'], eligibleVoters: ['@x'], roomIds: ['rA', 'rB'], createdByHandle: '@boss' });

describe('vote audit trail — append-only ballot history', () => {
  it('a re-vote APPENDS (history grows), tally keeps only the latest', () => {
    const v = mk();
    const yes = v.options.find((o) => o.label === 'Yes')!.id;
    const no = v.options.find((o) => o.label === 'No')!.id;

    const afterYes = castVoteBallot({ voteId: v.id, voterHandle: '@x', optionId: yes, roomId: 'rA', reason: 'first' });
    expect(afterYes.ballots.length).toBe(1); // tally: 1 ballot
    expect(getVoteBallotHistory(v.id).length).toBe(1); // history: 1 event

    const afterNo = castVoteBallot({ voteId: v.id, voterHandle: '@x', optionId: no, roomId: 'rB', reason: 'changed mind' });
    expect(afterNo.ballots.length).toBe(1); // tally STILL one ballot (latest)
    expect(afterNo.ballots[0].optionId).toBe(no);
    expect(getVoteBallotHistory(v.id).length).toBe(2); // history kept BOTH casts
  });

  it('history captures previous→new, labels, reason, room, order', () => {
    const v = mk();
    const yes = v.options.find((o) => o.label === 'Yes')!.id;
    const no = v.options.find((o) => o.label === 'No')!.id;
    castVoteBallot({ voteId: v.id, voterHandle: '@x', optionId: yes, roomId: 'rA', reason: 'a' });
    castVoteBallot({ voteId: v.id, voterHandle: '@x', optionId: no, roomId: 'rB', reason: 'b' });
    const h = getVoteBallotHistory(v.id);

    // oldest first
    expect(h[0].optionLabel).toBe('Yes');
    expect(h[0].previousOptionId).toBeNull(); // first cast replaced nothing
    expect(h[0].previousOptionLabel).toBeNull();
    expect(h[0].reason).toBe('a');
    expect(h[0].roomId).toBe('rA');

    expect(h[1].optionLabel).toBe('No');
    expect(h[1].previousOptionId).toBe(yes); // the change is recorded
    expect(h[1].previousOptionLabel).toBe('Yes');
    expect(h[1].reason).toBe('b');
    expect(h[1].roomId).toBe('rB');
    expect(h[1].seq).toBeGreaterThan(h[0].seq);
  });

  it('separate voters each get their own history rows', () => {
    const v = createVote({ title: 't', options: ['A', 'B'], eligibleVoters: ['@x', '@y'], roomIds: ['r'], createdByHandle: '@boss' });
    castVoteBallot({ voteId: v.id, voterHandle: '@x', optionId: v.options[0].id, roomId: 'r' });
    castVoteBallot({ voteId: v.id, voterHandle: '@y', optionId: v.options[1].id, roomId: 'r' });
    const h = getVoteBallotHistory(v.id);
    expect(h.map((e) => e.voterHandle).sort()).toEqual(['@x', '@y']);
  });
});
