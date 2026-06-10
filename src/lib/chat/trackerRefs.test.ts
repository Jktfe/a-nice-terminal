import { describe, expect, it } from 'vitest';
import { extractTrackerRefs } from './trackerRefs';

describe('extractTrackerRefs', () => {
  it('returns empty for nullish/empty input', () => {
    expect(extractTrackerRefs(null)).toEqual({ trackerIds: [], body: '' });
    expect(extractTrackerRefs('')).toEqual({ trackerIds: [], body: '' });
  });

  it('extracts a single trackerId and strips the fence', () => {
    const out = extractTrackerRefs('GVPL4 payments:\n\n```ant-tracker\ntrk_abc123\n```');
    expect(out.trackerIds).toEqual(['trk_abc123']);
    expect(out.body).toBe('GVPL4 payments:');
    expect(out.body).not.toContain('ant-tracker');
  });

  it('extracts multiple distinct ids in first-seen order, deduped', () => {
    const raw = '```ant-tracker\ntrk_b\n```\nmid\n```ant-tracker\ntrk_a\n```\n```ant-tracker\ntrk_b\n```';
    const out = extractTrackerRefs(raw);
    expect(out.trackerIds).toEqual(['trk_b', 'trk_a']);
    expect(out.body).toBe('mid');
  });

  it('is case-insensitive on the fence tag', () => {
    expect(extractTrackerRefs('```ANT-TRACKER\ntrk_x\n```').trackerIds).toEqual(['trk_x']);
  });

  it('drops an unsafe/empty id but still strips the fence', () => {
    expect(extractTrackerRefs('```ant-tracker\nrm -rf /\n```').trackerIds).toEqual([]);
    expect(extractTrackerRefs('```ant-tracker\nrm -rf /\n```').body).toBe('');
  });

  it('does NOT match ant-poll or ant-status fences (distinct primitive)', () => {
    expect(extractTrackerRefs('```ant-poll\nvote_1\n```').trackerIds).toEqual([]);
    expect(extractTrackerRefs('```ant-status\nstatus_1\n```').trackerIds).toEqual([]);
  });
});
