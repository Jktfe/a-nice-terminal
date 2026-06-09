import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import {
  castVoteBallot,
  closeVote,
  createVote,
  getVote,
  listVotesForRoom,
  resetVoteStoreSchemaForTests
} from './voteStore';

let tmpDir: string;
const previousEnvValue = process.env.ANT_FRESH_DB_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-votes-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  resetIdentityDbForTests();
  resetVoteStoreSchemaForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  resetVoteStoreSchemaForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousEnvValue === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousEnvValue;
});

describe('voteStore', () => {
  it('creates an open vote with options, eligible voters, room bindings, and missing voters', () => {
    const vote = createVote({
      title: 'Pick the Stage route',
      options: ['A', 'B'],
      eligibleVoters: ['@a', '@b'],
      roomIds: ['room-a', 'room-b'],
      createdByHandle: '@chair'
    });

    expect(vote.state).toBe('open');
    expect(vote.open).toBe(true);
    expect(vote.complete).toBe(false);
    expect(vote.options.map((option) => option.label)).toEqual(['A', 'B']);
    expect(vote.eligibleVoters).toEqual(['@a', '@b']);
    expect(vote.missingVoters).toEqual(['@a', '@b']);
    expect(vote.roomIds).toEqual(['room-a', 'room-b']);
    expect(vote.tally).toEqual([
      { optionId: vote.options[0].id, label: 'A', count: 0 },
      { optionId: vote.options[1].id, label: 'B', count: 0 }
    ]);
  });

  it('counts one ballot per eligible handle and completes when all voters have voted', () => {
    const vote = createVote({
      title: 'Merge?',
      options: ['yes', 'no'],
      eligibleVoters: ['@a', '@b'],
      roomIds: ['room-a'],
      createdByHandle: '@chair'
    });

    const afterA = castVoteBallot({
      voteId: vote.id,
      voterHandle: '@a',
      optionId: vote.options[0].id,
      roomId: 'room-a',
      reason: 'tested'
    });
    expect(afterA.complete).toBe(false);
    expect(afterA.missingVoters).toEqual(['@b']);
    expect(afterA.tally.find((row) => row.label === 'yes')?.count).toBe(1);

    const afterB = castVoteBallot({
      voteId: vote.id,
      voterHandle: '@b',
      optionId: vote.options[1].id,
      roomId: 'room-a'
    });
    expect(afterB.complete).toBe(true);
    expect(afterB.state).toBe('complete');
    expect(afterB.missingVoters).toEqual([]);
  });

  it('updates an existing handle ballot instead of double-counting it', () => {
    const vote = createVote({
      title: 'Route',
      options: ['left', 'right'],
      eligibleVoters: ['@a'],
      roomIds: ['room-a'],
      createdByHandle: '@chair'
    });

    castVoteBallot({ voteId: vote.id, voterHandle: '@a', optionId: vote.options[0].id, roomId: 'room-a' });
    const updated = castVoteBallot({ voteId: vote.id, voterHandle: '@a', optionId: vote.options[1].id, roomId: 'room-a' });

    expect(updated.ballots).toHaveLength(1);
    expect(updated.tally).toEqual([
      { optionId: vote.options[0].id, label: 'left', count: 0 },
      { optionId: vote.options[1].id, label: 'right', count: 1 }
    ]);
  });

  it('rejects ineligible voters, unknown options, unbound rooms, and closed votes', () => {
    const vote = createVote({
      title: 'Scope',
      options: ['small', 'big'],
      eligibleVoters: ['@a'],
      roomIds: ['room-a'],
      createdByHandle: '@chair'
    });

    expect(() => castVoteBallot({ voteId: vote.id, voterHandle: '@b', optionId: vote.options[0].id, roomId: 'room-a' }))
      .toThrow(/not eligible/);
    expect(() => castVoteBallot({ voteId: vote.id, voterHandle: '@a', optionId: 'missing', roomId: 'room-a' }))
      .toThrow(/option/);
    expect(() => castVoteBallot({ voteId: vote.id, voterHandle: '@a', optionId: vote.options[0].id, roomId: 'room-z' }))
      .toThrow(/not bound/);

    closeVote({ voteId: vote.id, closedByHandle: '@chair' });
    expect(() => castVoteBallot({ voteId: vote.id, voterHandle: '@a', optionId: vote.options[0].id, roomId: 'room-a' }))
      .toThrow(/closed/);
  });

  it('lists the same cross-room vote from each bound room without duplicating ballot power', () => {
    const vote = createVote({
      title: 'Cross-room decision',
      options: ['one', 'two'],
      eligibleVoters: ['@a', '@b'],
      roomIds: ['room-a', 'room-b'],
      createdByHandle: '@chair'
    });
    castVoteBallot({ voteId: vote.id, voterHandle: '@a', optionId: vote.options[0].id, roomId: 'room-b' });

    expect(listVotesForRoom('room-a').map((row) => row.id)).toEqual([vote.id]);
    expect(listVotesForRoom('room-b').map((row) => row.id)).toEqual([vote.id]);
    expect(getVote(vote.id)?.ballots.map((ballot) => ballot.voterHandle)).toEqual(['@a']);
  });
});
