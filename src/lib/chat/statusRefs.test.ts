import { describe, expect, it } from 'vitest';
import { extractStatusRefs } from './statusRefs';

describe('extractStatusRefs', () => {
  it('returns empty for nullish/empty input', () => {
    expect(extractStatusRefs(null)).toEqual({ boardIds: [], body: '' });
    expect(extractStatusRefs(undefined)).toEqual({ boardIds: [], body: '' });
    expect(extractStatusRefs('')).toEqual({ boardIds: [], body: '' });
  });

  it('leaves a plain message untouched', () => {
    const out = extractStatusRefs('A normal message with `code` and a | table |');
    expect(out.boardIds).toEqual([]);
    expect(out.body).toBe('A normal message with `code` and a | table |');
  });

  it('extracts a single board id and strips the fence', () => {
    const out = extractStatusRefs('Milestone tracker:\n\n```ant-status\nstatus_abc123\n```');
    expect(out.boardIds).toEqual(['status_abc123']);
    expect(out.body).toBe('Milestone tracker:');
    expect(out.body).not.toContain('ant-status');
  });

  it('extracts multiple distinct board ids in first-seen order, deduped', () => {
    const raw =
      '```ant-status\nstatus_b\n```\nmid\n```ant-status\nstatus_a\n```\n```ant-status\nstatus_b\n```';
    const out = extractStatusRefs(raw);
    expect(out.boardIds).toEqual(['status_b', 'status_a']);
    expect(out.body).toBe('mid');
  });

  it('matches a uuid-shaped board id (vote id with kind:status)', () => {
    const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
    const out = extractStatusRefs(`opened\n\n\`\`\`ant-status\n${id}\n\`\`\``);
    expect(out.boardIds).toEqual([id]);
  });

  it('is case-insensitive on the fence tag', () => {
    expect(extractStatusRefs('```ANT-STATUS\nstatus_x\n```').boardIds).toEqual(['status_x']);
  });

  it('drops a fence whose body is not a safe single token, but still strips it', () => {
    expect(extractStatusRefs('```ant-status\n\n```').boardIds).toEqual([]);
    expect(extractStatusRefs('```ant-status\nrm -rf /\n```').boardIds).toEqual([]);
    expect(extractStatusRefs('```ant-status\nrm -rf /\n```').body).toBe('');
  });

  it('takes the first non-empty line as the board id', () => {
    const out = extractStatusRefs('```ant-status\n\n  status_z \n trailing\n```');
    expect(out.boardIds).toEqual(['status_z']);
  });

  it('does NOT match an ant-poll fence (distinct from polls)', () => {
    const out = extractStatusRefs('```ant-poll\nvote_1\n```');
    expect(out.boardIds).toEqual([]);
    // a poll fence is left in the body for pollRefs to handle
    expect(out.body).toContain('ant-poll');
  });
});
