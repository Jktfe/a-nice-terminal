import { describe, expect, it } from 'vitest';
import { activeRoutingMentions, bracketRoutingMention } from '../src/lib/utils/mentions.js';

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
