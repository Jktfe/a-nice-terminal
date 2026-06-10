import { describe, expect, it } from 'vitest';
import { substituteShortcutTokens } from './shortcutTokens';

describe('substituteShortcutTokens', () => {
  it("substitutes [terminalHandle] — JWPK's /rename shortcut", () => {
    expect(
      substituteShortcutTokens('/rename [terminalHandle]', { terminalHandle: '@masterclaude' })
    ).toBe('/rename @masterclaude');
  });

  it('substitutes [terminalName]', () => {
    expect(substituteShortcutTokens('echo [terminalName]', { terminalName: 'speedyClaude' })).toBe(
      'echo speedyClaude'
    );
  });

  it('substitutes multiple tokens in one chip', () => {
    expect(
      substituteShortcutTokens('/rename [terminalHandle] # was [terminalName]', {
        terminalHandle: '@x',
        terminalName: 'old'
      })
    ).toBe('/rename @x # was old');
  });

  it('leaves the token verbatim when the value is missing/empty (never types a bare /rename)', () => {
    expect(substituteShortcutTokens('/rename [terminalHandle]', {})).toBe('/rename [terminalHandle]');
    expect(substituteShortcutTokens('/rename [terminalHandle]', { terminalHandle: '  ' })).toBe(
      '/rename [terminalHandle]'
    );
  });

  it('leaves unknown bracket text untouched (may be literal user text)', () => {
    expect(substituteShortcutTokens('grep [a-z] file', { terminalHandle: '@x' })).toBe(
      'grep [a-z] file'
    );
  });

  it('plain chips pass through unchanged', () => {
    expect(substituteShortcutTokens('claude --resume', { terminalHandle: '@x' })).toBe(
      'claude --resume'
    );
  });
});
