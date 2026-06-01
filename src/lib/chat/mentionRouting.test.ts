import { describe, expect, it } from 'vitest';
import {
  hasBareAtMarker,
  hasBareEveryoneMention,
  hasBracketedMention,
  listBareMentionHandles
} from './mentionRouting';

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

  it('ignores @mentions inside double quotes (JWPK msg_5xglxgebc6)', () => {
    expect(listBareMentionHandles('"@codex said this" but @svelte did that')).toEqual(['@svelte']);
    expect(listBareMentionHandles('"@everyone" is just a quote')).toEqual([]);
    expect(listBareMentionHandles('no quotes here @codex')).toEqual(['@codex']);
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

describe('hasBareAtMarker', () => {
  it('detects a standalone @ marker for the logged-in human shorthand', () => {
    expect(hasBareAtMarker('@')).toBe(true);
    expect(hasBareAtMarker('please @ decide')).toBe(true);
    expect(hasBareAtMarker('please @.')).toBe(true);
  });

  it('does not treat handles, emails, or quoted markers as standalone @', () => {
    expect(hasBareAtMarker('@you')).toBe(false);
    expect(hasBareAtMarker('mail@example.com')).toBe(false);
    expect(hasBareAtMarker('"@" is quoted')).toBe(false);
  });
});
