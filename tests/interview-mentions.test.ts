// M2 #1 — interview mention detection utility tests
import { describe, expect, it } from 'vitest';
import { interviewMentions } from '../src/lib/utils/mentions.js';

const HANDLES = [
  { handle: '@claude', name: 'Claude' },
  { handle: '@codex', name: 'Codex' },
  { handle: '@kimi', name: 'Kimi' },
];

describe('interviewMentions', () => {
  it('returns empty when no trigger words are present', () => {
    expect(interviewMentions('Hey @claude how are you?', HANDLES)).toEqual([]);
  });

  it('detects @mention followed by "interview"', () => {
    expect(interviewMentions('@claude interview me about the API', HANDLES)).toEqual([
      { handle: '@claude', name: 'Claude' },
    ]);
  });

  it('detects multiple interview targets', () => {
    expect(interviewMentions('I want to interview @claude and @codex about the design', HANDLES)).toEqual([
      { handle: '@claude', name: 'Claude' },
      { handle: '@codex', name: 'Codex' },
    ]);
  });

  it('ignores handles that are not in the text', () => {
    expect(interviewMentions('Let us interview @kimi', HANDLES)).toEqual([
      { handle: '@kimi', name: 'Kimi' },
    ]);
  });

  it('is case-insensitive for trigger words', () => {
    expect(interviewMentions('@CLAUDE INTERVIEW about security', HANDLES)).toEqual([
      { handle: '@claude', name: 'Claude' },
    ]);
  });

  it('returns empty when trigger word is present but no known handles', () => {
    expect(interviewMentions('interview with @unknown-agent', HANDLES)).toEqual([]);
  });
});
