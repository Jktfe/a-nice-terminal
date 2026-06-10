import { describe, expect, it } from 'vitest';
import {
  looksLikeBreakCommand,
  reasonFromBreakCommand,
  looksLikeStatusPollCommand,
  parseStatusPollCommand,
  DEFAULT_STATUS_STATES
} from './composerSlashCommands';

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

  describe('looksLikeStatusPollCommand', () => {
    it('matches bare + with-args, case-insensitive, whitespace-tolerant', () => {
      expect(looksLikeStatusPollCommand('/status-poll')).toBe(true);
      expect(looksLikeStatusPollCommand('/status-poll "x"')).toBe(true);
      expect(looksLikeStatusPollCommand('  /STATUS-POLL  "x"  ')).toBe(true);
    });
    it('does not match unrelated input', () => {
      expect(looksLikeStatusPollCommand('/status')).toBe(false);
      expect(looksLikeStatusPollCommand('/status-pollard')).toBe(false);
      expect(looksLikeStatusPollCommand('status-poll x')).toBe(false);
      expect(looksLikeStatusPollCommand('')).toBe(false);
    });
  });

  describe('parseStatusPollCommand', () => {
    it("parses JWPK's full example: states + title + agents", () => {
      const out = parseStatusPollCommand(
        '/status-poll [complete/in progress/stuck/blocked] "Delivered visual poll research" --agents [@alpha @beta @gamma]'
      );
      expect(out).toEqual({
        states: ['complete', 'in progress', 'stuck', 'blocked'],
        title: 'Delivered visual poll research',
        agents: ['@alpha', '@beta', '@gamma']
      });
    });

    it('defaults states when the bracket is omitted', () => {
      const out = parseStatusPollCommand('/status-poll "Ship it"');
      expect(out?.states).toEqual([...DEFAULT_STATUS_STATES]);
      expect(out?.title).toBe('Ship it');
      expect(out?.agents).toEqual([]);
    });

    it('does not mistake the --agents bracket for the states bracket', () => {
      const out = parseStatusPollCommand('/status-poll "Research done" --agents [@a @b]');
      expect(out?.states).toEqual([...DEFAULT_STATUS_STATES]);
      expect(out?.agents).toEqual(['@a', '@b']);
      expect(out?.title).toBe('Research done');
    });

    it('normalises @ on agents and accepts comma separation', () => {
      const out = parseStatusPollCommand('/status-poll "x" --agents [alpha, @beta,gamma]');
      expect(out?.agents).toEqual(['@alpha', '@beta', '@gamma']);
    });

    it('falls back to leftover text as the title when unquoted', () => {
      const out = parseStatusPollCommand('/status-poll [done/wip] milestone one');
      expect(out?.states).toEqual(['done', 'wip']);
      expect(out?.title).toBe('milestone one');
    });

    it('returns null when there is no title', () => {
      expect(parseStatusPollCommand('/status-poll')).toBeNull();
      expect(parseStatusPollCommand('/status-poll [a/b]')).toBeNull();
      expect(parseStatusPollCommand('/status-poll --agents [@a]')).toBeNull();
    });

    it('returns null for non-status-poll input', () => {
      expect(parseStatusPollCommand('/break x')).toBeNull();
    });
  });
});
