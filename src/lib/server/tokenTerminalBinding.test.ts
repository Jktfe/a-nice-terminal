import { afterEach, describe, expect, it } from 'vitest';
import {
  evaluateTokenTerminalBinding,
  tokenTerminalBindingMode,
  tokenBindingAction,
  sessionFingerprint
} from './tokenTerminalBinding';

const prev = process.env.ANT_TOKEN_TERMINAL_BINDING;
afterEach(() => {
  if (prev === undefined) delete process.env.ANT_TOKEN_TERMINAL_BINDING;
  else process.env.ANT_TOKEN_TERMINAL_BINDING = prev;
});

describe('sessionFingerprint (credential hygiene)', () => {
  const token = 'e8afd5da-f445-4f4f-8d1d-36d1f9e2f32a-supersecret';
  it('is short, hex, deterministic', () => {
    const fp = sessionFingerprint(token);
    expect(fp).toMatch(/^[0-9a-f]{8}$/);
    expect(sessionFingerprint(token)).toBe(fp);
  });
  it('NEVER contains the raw token (non-reversible)', () => {
    const fp = sessionFingerprint(token);
    expect(token).not.toContain(fp);
    expect(fp).not.toContain(token.slice(0, 8));
  });
  it('different tokens → different fingerprints', () => {
    expect(sessionFingerprint('aaa')).not.toBe(sessionFingerprint('bbb'));
  });
});

describe('tokenTerminalBindingMode', () => {
  it('defaults to flag (lockout-safe) when unset or unknown', () => {
    delete process.env.ANT_TOKEN_TERMINAL_BINDING;
    expect(tokenTerminalBindingMode()).toBe('flag');
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'wibble';
    expect(tokenTerminalBindingMode()).toBe('flag');
  });
  it('reads off / strict (case-insensitive)', () => {
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'OFF';
    expect(tokenTerminalBindingMode()).toBe('off');
    process.env.ANT_TOKEN_TERMINAL_BINDING = 'Strict';
    expect(tokenTerminalBindingMode()).toBe('strict');
  });
});

describe('evaluateTokenTerminalBinding', () => {
  it('BOUND when the caller pidChain resolves to the session terminal', () => {
    const r = evaluateTokenTerminalBinding('t_abc', 't_abc', true);
    expect(r).toEqual({ bound: true, kind: 'bound', violation: null });
  });
  it('BOUND (un-enforceable) when the session has no terminal anchor (legacy)', () => {
    const r = evaluateTokenTerminalBinding(null, 't_other', true);
    expect(r.bound).toBe(true);
    expect(r.kind).toBe('bound');
  });
  it('wrong-terminal when pidChain resolves to a DIFFERENT terminal (active theft)', () => {
    const r = evaluateTokenTerminalBinding('t_owner', 't_thief', true);
    expect(r.bound).toBe(false);
    expect(r.kind).toBe('wrong-terminal');
    expect(r.violation).toContain('t_thief');
    expect(r.violation).toContain('t_owner');
  });
  it('no-pidchain when a token is presented without any pidChain (raw replay)', () => {
    const r = evaluateTokenTerminalBinding('t_owner', null, false);
    expect(r.bound).toBe(false);
    expect(r.kind).toBe('no-pidchain');
  });
  it('unresolvable when a pidChain is sent but matches no live terminal', () => {
    const r = evaluateTokenTerminalBinding('t_owner', null, true);
    expect(r.bound).toBe(false);
    expect(r.kind).toBe('unresolvable');
  });
});

describe('tokenBindingAction (the R2 safe-partial rule)', () => {
  const wrong = evaluateTokenTerminalBinding('t_owner', 't_thief', true);   // active theft
  const none = evaluateTokenTerminalBinding('t_owner', null, false);         // token-only
  const ok = evaluateTokenTerminalBinding('t_abc', 't_abc', true);          // bound

  it('always allows a bound caller', () => {
    expect(tokenBindingAction(ok, 'strict')).toBe('allow');
    expect(tokenBindingAction(ok, 'flag')).toBe('allow');
  });
  it('off mode allows everything', () => {
    expect(tokenBindingAction(wrong, 'off')).toBe('allow');
    expect(tokenBindingAction(none, 'off')).toBe('allow');
  });
  it('flag mode only LOGS violations (never rejects) — lockout-safe deploy', () => {
    expect(tokenBindingAction(wrong, 'flag')).toBe('log');
    expect(tokenBindingAction(none, 'flag')).toBe('log');
  });
  it('strict mode REJECTS active cross-terminal theft only', () => {
    expect(tokenBindingAction(wrong, 'strict')).toBe('reject');
  });
  it('strict mode does NOT reject token-only/no-pidchain at R2 (no inverted lockout; tightens in R3)', () => {
    expect(tokenBindingAction(none, 'strict')).toBe('log');
  });
});
