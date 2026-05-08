import { describe, expect, it } from 'vitest';
import {
  activeRoutingMentions,
  bracketRoutingMention,
  mentionLiteralMatchesHandle,
  ensureTrailingMentionBoundary,
  shouldCompleteMentionOnEnter,
} from '../src/lib/utils/mentions.js';

const handles = [
  { handle: '@claude', name: 'Claude' },
  { handle: '@master-dave', name: 'MasterDave' },
  { handle: '@everyone', name: 'Everyone' },
];

describe('composer mention helpers', () => {
  it('finds active routable mentions and ignores bracketed mentions', () => {
    expect(activeRoutingMentions('hey @claude and [@everyone]', handles).map((h) => h.handle)).toEqual([
      '@claude',
    ]);
  });

  it('brackets matching active mentions without touching already-bracketed text', () => {
    expect(bracketRoutingMention('hey @claude and [@claude]', '@claude')).toBe('hey [@claude] and [@claude]');
  });

  it('respects handle boundaries', () => {
    expect(activeRoutingMentions('email foo@claude.com but ping @master-dave', handles).map((h) => h.handle)).toEqual([
      '@master-dave',
    ]);
  });
});

describe('mention autocomplete completion', () => {
  it('treats the literal typed @handle as already complete', () => {
    expect(mentionLiteralMatchesHandle('@everyone', '@everyone')).toBe(true);
    expect(mentionLiteralMatchesHandle('everyone', '@everyone')).toBe(true);
    expect(mentionLiteralMatchesHandle('@EveryOne', '@everyone')).toBe(true);
  });

  it('lets Enter submit when the selected handle is already fully typed', () => {
    expect(shouldCompleteMentionOnEnter({
      typedMention: '@everyone',
      selectedHandle: '@everyone',
      navigated: false,
    })).toBe(false);
  });

  it('keeps Enter completion for partial or explicitly navigated mentions', () => {
    expect(shouldCompleteMentionOnEnter({
      typedMention: '@ever',
      selectedHandle: '@everyone',
      navigated: false,
    })).toBe(true);

    expect(shouldCompleteMentionOnEnter({
      typedMention: '@everyone',
      selectedHandle: '@everyone',
      navigated: true,
    })).toBe(true);
  });
});

describe('mention send boundary', () => {
  it('adds a trailing boundary space for messages ending in a standalone @handle', () => {
    expect(ensureTrailingMentionBoundary('please read this @everyone')).toBe('please read this @everyone ');
    expect(ensureTrailingMentionBoundary('@antCC')).toBe('@antCC ');
  });

  it('leaves existing spacing and non-mentions alone', () => {
    expect(ensureTrailingMentionBoundary('please read this @everyone ')).toBe('please read this @everyone ');
    expect(ensureTrailingMentionBoundary('email me@site')).toBe('email me@site');
    expect(ensureTrailingMentionBoundary('hello @')).toBe('hello @');
  });
});
