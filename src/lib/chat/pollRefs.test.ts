import { describe, expect, it } from 'vitest';
import { extractPollRefs } from './pollRefs';

describe('extractPollRefs', () => {
  it('returns empty for nullish/empty input', () => {
    expect(extractPollRefs(null)).toEqual({ voteIds: [], body: '' });
    expect(extractPollRefs(undefined)).toEqual({ voteIds: [], body: '' });
    expect(extractPollRefs('')).toEqual({ voteIds: [], body: '' });
  });

  it('leaves a plain message untouched', () => {
    const out = extractPollRefs('Just a normal message with `code` and a | table |');
    expect(out.voteIds).toEqual([]);
    expect(out.body).toBe('Just a normal message with `code` and a | table |');
  });

  it('extracts a single voteId and strips the fence', () => {
    const out = extractPollRefs('Cast your vote:\n\n```ant-poll\nvote_abc123\n```');
    expect(out.voteIds).toEqual(['vote_abc123']);
    expect(out.body).toBe('Cast your vote:');
    expect(out.body).not.toContain('ant-poll');
  });

  it('extracts multiple distinct voteIds in first-seen order, deduped', () => {
    const raw = '```ant-poll\nvote_b\n```\nmiddle\n```ant-poll\nvote_a\n```\n```ant-poll\nvote_b\n```';
    const out = extractPollRefs(raw);
    expect(out.voteIds).toEqual(['vote_b', 'vote_a']);
    expect(out.body).toBe('middle');
  });

  it('matches a uuid-shaped voteId', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const out = extractPollRefs(`opened\n\n\`\`\`ant-poll\n${id}\n\`\`\``);
    expect(out.voteIds).toEqual([id]);
  });

  it('is case-insensitive on the fence tag', () => {
    const out = extractPollRefs('```ANT-POLL\nvote_x\n```');
    expect(out.voteIds).toEqual(['vote_x']);
  });

  it('drops a fence whose body is not a safe single token', () => {
    expect(extractPollRefs('```ant-poll\n\n```').voteIds).toEqual([]);
    expect(extractPollRefs('```ant-poll\nrm -rf /\n```').voteIds).toEqual([]);
    // The fence is still stripped from the body even when the id is rejected.
    expect(extractPollRefs('```ant-poll\nrm -rf /\n```').body).toBe('');
  });

  it('takes the first non-empty line as the voteId', () => {
    const out = extractPollRefs('```ant-poll\n\n  vote_z \n trailing\n```');
    expect(out.voteIds).toEqual(['vote_z']);
  });

  it('collapses blank lines left by stripped fences', () => {
    const out = extractPollRefs('before\n\n```ant-poll\nvote_1\n```\n\nafter');
    expect(out.voteIds).toEqual(['vote_1']);
    expect(out.body).toBe('before\n\nafter');
  });
});
