import { describe, expect, it } from 'vitest';
import {
  ensureUsableTerm,
  hasUsableTerm,
  PTY_HOST_TERM,
  PTY_TMUX_TERM,
  resolveOriginalZdotdir,
} from '../src/lib/server/pty-env';

describe('PTY terminal environment helpers', () => {
  it('treats empty and dumb TERM values as unusable', () => {
    expect(hasUsableTerm(undefined)).toBe(false);
    expect(hasUsableTerm('')).toBe(false);
    expect(hasUsableTerm('   ')).toBe(false);
    expect(hasUsableTerm('dumb')).toBe(false);
  });

  it('keeps an existing usable TERM', () => {
    const env: Record<string, string | undefined> = { TERM: PTY_TMUX_TERM };
    expect(ensureUsableTerm(env)).toBe(env);
    expect(env.TERM).toBe(PTY_TMUX_TERM);
  });

  it('falls back to a terminal type accepted by interactive TUIs', () => {
    const env: Record<string, string | undefined> = { TERM: 'dumb' };
    ensureUsableTerm(env);
    expect(env.TERM).toBe(PTY_HOST_TERM);
  });

  it('does not use ANT runtime ZDOTDIR as the original user zsh config dir', () => {
    const runtime = '/Users/jamesking/.ant/hooks/runtime/session/zdotdir';
    expect(resolveOriginalZdotdir({ ZDOTDIR: runtime }, runtime, '/Users/jamesking')).toBe('/Users/jamesking');
    expect(resolveOriginalZdotdir({ ANT_ORIGINAL_ZDOTDIR: runtime, ZDOTDIR: runtime }, runtime, '/Users/jamesking')).toBe('/Users/jamesking');
  });

  it('prefers a real previous original zsh config dir when present', () => {
    const runtime = '/Users/jamesking/.ant/hooks/runtime/session/zdotdir';
    expect(resolveOriginalZdotdir({
      ANT_ORIGINAL_ZDOTDIR: '/Users/jamesking/custom-zdotdir',
      ZDOTDIR: runtime,
    }, runtime, '/Users/jamesking')).toBe('/Users/jamesking/custom-zdotdir');
  });
});
