import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  evaluateDeprecation,
  applyDeprecationOrThrow,
  AUTH_DEPRECATION_HEADER,
  AUTH_DEPRECATION_HINT_BODY
} from './authDeprecation';

const previousEnv = process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  if (previousEnv === undefined) delete process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
  else process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = previousEnv;
  warnSpy.mockRestore();
});

describe('evaluateDeprecation', () => {
  it('returns strict=false during warning phase (cutover in the future)', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    const verdict = evaluateDeprecation('messages-post');
    expect(verdict.strict).toBe(false);
    expect(verdict.headerName).toBe(AUTH_DEPRECATION_HEADER);
    expect(verdict.headerValue).toMatch(/^warning;route=messages-post;cutover=/);
    expect(verdict.hintBody).toBe(AUTH_DEPRECATION_HINT_BODY);
  });

  it('emits a console.warn during warning phase so operators can audit legacy traffic', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    evaluateDeprecation('messages-post');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toMatch(/\[auth-deprecation\] messages-post/);
  });

  it('returns strict=true once cutover has elapsed', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    const verdict = evaluateDeprecation('members-delete');
    expect(verdict.strict).toBe(true);
    expect(verdict.headerValue).toBe('enforced;route=members-delete');
  });

  it('does NOT warn-log when strict (the 403 throw is its own signal)', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    evaluateDeprecation('members-delete');
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('default cutover applies when env unset (uses 2026-05-28 ISO)', () => {
    delete process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
    const verdict = evaluateDeprecation('messages-post', new Date('2026-05-15T00:00:00Z').getTime());
    expect(verdict.strict).toBe(false);
    expect(verdict.headerValue).toContain('cutover=2026-05-28T00:00:00.000Z');
  });

  it('honours an explicit now parameter for time-travel tests', () => {
    delete process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
    const future = new Date('2030-01-01T00:00:00Z').getTime();
    expect(evaluateDeprecation('messages-post', future).strict).toBe(true);
  });
});

describe('applyDeprecationOrThrow', () => {
  it('throws 403 with hint body in strict phase', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = '0';
    let captured: unknown = null;
    try { applyDeprecationOrThrow('discussions-post'); } catch (caught) { captured = caught; }
    expect(captured).toBeTruthy();
    expect((captured as { status: number }).status).toBe(403);
    expect((captured as { body: { message: string } }).body.message).toBe(AUTH_DEPRECATION_HINT_BODY);
  });

  it('returns header pair (no throw) in warning phase', () => {
    process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS = String(Date.now() + 86_400_000);
    const header = applyDeprecationOrThrow('messages-post');
    expect(header.headerName).toBe(AUTH_DEPRECATION_HEADER);
    expect(header.headerValue).toMatch(/^warning;/);
  });
});
