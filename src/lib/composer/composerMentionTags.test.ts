import { describe, it, expect } from 'vitest';
import {
  detectMentionTags,
  convertBareToBracketed,
  convertBracketedToBare,
  removeMentionFromBody
} from './composerMentionTags';

describe('detectMentionTags', () => {
  it('returns empty array for empty body', () => {
    expect(detectMentionTags('')).toEqual([]);
  });

  it('detects a single bare mention at start of body', () => {
    const tags = detectMentionTags('@codex hello');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ handle: '@codex', kind: 'bare', startIndexInBody: 0, endIndexInBody: 6 });
  });

  it('detects a bare mention after whitespace', () => {
    const tags = detectMentionTags('hi @codex how are you');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ handle: '@codex', kind: 'bare', startIndexInBody: 3, endIndexInBody: 9 });
  });

  it('does NOT detect @ embedded in other text (email-ish)', () => {
    expect(detectMentionTags('email a@b.com here')).toEqual([]);
  });

  it('detects a single bracketed mention', () => {
    const tags = detectMentionTags('FYI [@deep] for context');
    expect(tags).toHaveLength(1);
    expect(tags[0]).toMatchObject({ handle: '@deep', kind: 'bracketed', startIndexInBody: 4, endIndexInBody: 11 });
  });

  it('detects multiple mixed mentions in body order', () => {
    const tags = detectMentionTags('@swift ping [@kimi] for review @deep');
    expect(tags.map((t) => ({ handle: t.handle, kind: t.kind }))).toEqual([
      { handle: '@swift', kind: 'bare' },
      { handle: '@kimi', kind: 'bracketed' },
      { handle: '@deep', kind: 'bare' }
    ]);
  });

  it('supports handles with dashes and underscores and digits', () => {
    const tags = detectMentionTags('@evolveant-swift @ant_codex2');
    expect(tags.map((t) => t.handle)).toEqual(['@evolveant-swift', '@ant_codex2']);
  });
});

describe('convertBareToBracketed', () => {
  it('wraps a bare mention with brackets', () => {
    const body = '@codex hello';
    const tag = detectMentionTags(body)[0];
    expect(convertBareToBracketed(body, tag)).toBe('[@codex] hello');
  });

  it('only touches the targeted mention when others are present', () => {
    const body = '@a hi @b';
    const tag = detectMentionTags(body)[1];
    expect(convertBareToBracketed(body, tag)).toBe('@a hi [@b]');
  });

  it('is a no-op when called on a bracketed tag', () => {
    const body = '[@codex] hi';
    const tag = detectMentionTags(body)[0];
    expect(convertBareToBracketed(body, tag)).toBe(body);
  });
});

describe('convertBracketedToBare', () => {
  it('unwraps a bracketed mention', () => {
    const body = '[@codex] hello';
    const tag = detectMentionTags(body)[0];
    expect(convertBracketedToBare(body, tag)).toBe('@codex hello');
  });

  it('is a no-op when called on a bare tag', () => {
    const body = '@codex hi';
    const tag = detectMentionTags(body)[0];
    expect(convertBracketedToBare(body, tag)).toBe(body);
  });
});

describe('removeMentionFromBody', () => {
  it('removes a bare mention and its trailing space', () => {
    const body = '@codex hello world';
    const tag = detectMentionTags(body)[0];
    expect(removeMentionFromBody(body, tag)).toBe('hello world');
  });

  it('removes a mid-body bare mention and one trailing space', () => {
    const body = 'hi @codex how are you';
    const tag = detectMentionTags(body)[0];
    expect(removeMentionFromBody(body, tag)).toBe('hi how are you');
  });

  it('removes a bracketed mention and its trailing space', () => {
    const body = '[@codex] hello';
    const tag = detectMentionTags(body)[0];
    expect(removeMentionFromBody(body, tag)).toBe('hello');
  });

  it('removes a trailing mention without a following space', () => {
    const body = 'hello @codex';
    const tag = detectMentionTags(body)[0];
    expect(removeMentionFromBody(body, tag)).toBe('hello ');
  });
});
