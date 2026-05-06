import { describe, it, expect } from 'vitest';
import { inferAsks } from '../src/lib/server/asks-inference.js';

describe('inferAsks', () => {
  it('extracts trimmed lines ending with a question mark', () => {
    const out = inferAsks('Hello there.\nShould we ship it?\nThanks.');
    expect(out).toEqual(['Should we ship it?']);
  });

  it('extracts imperative starters even without a trailing question mark', () => {
    const out = inferAsks('Can you review this PR\nWould you mind a sanity check\nNot an ask.');
    expect(out).toEqual(['Can you review this PR', 'Would you mind a sanity check']);
  });

  it('does not extract lines inside fenced code blocks', () => {
    const content = [
      'Real ask first?',
      '```',
      'Should we delete this code?',
      'can you run npm install',
      '```',
      'After fence: shall we proceed?',
    ].join('\n');
    const out = inferAsks(content);
    expect(out).toEqual(['Real ask first?', 'After fence: shall we proceed?']);
  });

  it('skips lines longer than 280 characters', () => {
    const longLine = 'Can you ' + 'really really '.repeat(40) + 'do this thing?';
    expect(longLine.length).toBeGreaterThan(280);
    const out = inferAsks(`${longLine}\nCan you do the short one?`);
    expect(out).toEqual(['Can you do the short one?']);
  });

  it('deduplicates against the explicit list (case-insensitive, whitespace-tolerant)', () => {
    const out = inferAsks('Should we merge?\n  should WE merge?  \nCan you also test?', ['should we merge?']);
    expect(out).toEqual(['Can you also test?']);
  });

  it('preserves order of appearance and dedups within the inferred set', () => {
    const out = inferAsks('Can you start?\nUnrelated.\ncan you start?\nWill you finish?');
    expect(out).toEqual(['Can you start?', 'Will you finish?']);
  });

  it('caps the result at 8 asks even when more are present', () => {
    const lines: string[] = [];
    for (let i = 1; i <= 12; i++) lines.push(`Can you check item ${i}?`);
    const out = inferAsks(lines.join('\n'));
    expect(out).toHaveLength(8);
    expect(out[0]).toBe('Can you check item 1?');
    expect(out[7]).toBe('Can you check item 8?');
  });

  it('normalises internal whitespace to single spaces', () => {
    const out = inferAsks('Can\tyou   please    review?');
    expect(out).toEqual(['Can you please review?']);
  });
});
