import { describe, expect, it } from 'vitest';
import { looksLikeBreakCommand, reasonFromBreakCommand } from './composerSlashCommands';

describe('composerSlashCommands', () => {
  describe('looksLikeBreakCommand', () => {
    it('matches a bare /break', () => {
      expect(looksLikeBreakCommand('/break')).toBe(true);
    });

    it('matches /break with a reason after it', () => {
      expect(looksLikeBreakCommand('/break switching tracks')).toBe(true);
    });

    it('matches case-insensitively', () => {
      expect(looksLikeBreakCommand('/BREAK')).toBe(true);
      expect(looksLikeBreakCommand('/Break done')).toBe(true);
    });

    it('ignores leading and trailing whitespace', () => {
      expect(looksLikeBreakCommand('   /break   ')).toBe(true);
    });

    it('does not match unrelated slash commands', () => {
      expect(looksLikeBreakCommand('/help')).toBe(false);
      expect(looksLikeBreakCommand('/breakdance')).toBe(false);
    });

    it('does not match regular text starting with break', () => {
      expect(looksLikeBreakCommand('break the loop')).toBe(false);
    });

    it('does not match an empty string', () => {
      expect(looksLikeBreakCommand('')).toBe(false);
    });
  });

  describe('reasonFromBreakCommand', () => {
    it('returns the reason after /break', () => {
      expect(reasonFromBreakCommand('/break switching tracks')).toBe('switching tracks');
    });

    it('returns an empty string for a bare /break', () => {
      expect(reasonFromBreakCommand('/break')).toBe('');
    });

    it('trims whitespace around the reason', () => {
      expect(reasonFromBreakCommand('/break    hello    ')).toBe('hello');
    });
  });
});
