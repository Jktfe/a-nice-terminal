import { describe, expect, it } from 'vitest';
import { hasBareEveryoneMention, hasBracketedMention, listBareMentionHandles } from './mentionRouting';

describe('hasBareEveryoneMention', () => {
  it('detects bare @everyone at the start or after whitespace', () => {
    expect(hasBareEveryoneMention('@everyone ship it')).toBe(true);
    expect(hasBareEveryoneMention('please @everyone check this')).toBe(true);
  });

  it('ignores bracketed informational [@everyone]', () => {
    expect(hasBareEveryoneMention('please [@everyone] note this')).toBe(false);
  });

  it('does not match embedded or longer tokens', () => {
    expect(hasBareEveryoneMention('mail@example.com')).toBe(false);
    expect(hasBareEveryoneMention('hello@everyone')).toBe(false);
    expect(hasBareEveryoneMention('@everyoneish')).toBe(false);
  });
});

describe('listBareMentionHandles', () => {
  it('lists bare handles at the start or after whitespace', () => {
    expect(listBareMentionHandles('@codex please ask @svelte.')).toEqual(['@codex', '@svelte']);
  });

  it('ignores bracketed informational mentions', () => {
    expect(listBareMentionHandles('FYI [@codex] and @svelte')).toEqual(['@svelte']);
  });

  it('does not match embedded or longer tokens', () => {
    expect(listBareMentionHandles('mail@example.com hello@codex @codexish')).toEqual(['@codexish']);
  });
});

describe('hasBracketedMention', () => {
  it('detects informational bracketed handles', () => {
    expect(hasBracketedMention('FYI [@codex] no action')).toBe(true);
  });

  it('does not treat bare handles as bracketed', () => {
    expect(hasBracketedMention('@codex please check')).toBe(false);
  });
});
