import { describe, expect, it } from 'vitest';
import { formatCallFailure } from './ant-cli.mjs';

// 0.1.8 slice D (Xeno windows-cli-auth-wedge follow-up 2026-05-22):
// either wedge-state server signature triggers a concrete recovery
// hint appended to the error output. Non-wedge errors pass through.
describe('formatCallFailure — wedge-state hint', () => {
  it('appends the recovery hint for 403 "Server-resolved identity required"', () => {
    const err = new Error('POST /api/chat-rooms/r1/messages returned 403: Server-resolved identity required.');
    const out = formatCallFailure(err);
    expect(out).toContain('Server-resolved identity required');
    expect(out).toContain('⚠ No terminal is registered for this shell');
    expect(out).toContain('ant register --name');
  });

  it('appends the recovery hint for 400 "pids must be a non-empty array"', () => {
    const err = new Error('GET /api/identity/resolve returned 400: pids must be a non-empty array of {pid, pid_start} entries.');
    const out = formatCallFailure(err);
    expect(out).toContain('pids must be a non-empty array');
    expect(out).toContain('⚠ No terminal is registered for this shell');
  });

  it('does NOT append the hint for unrelated errors', () => {
    const err = new Error('GET /api/whatever returned 500: internal server error.');
    const out = formatCallFailure(err);
    expect(out).not.toContain('No terminal is registered');
    expect(out).not.toContain('⚠');
  });

  it('preserves the stack trace alongside the hint', () => {
    const err = new Error('returned 403: Server-resolved identity required');
    // jam a fake stack onto the error
    err.stack = 'Error: returned 403\n    at runSend (file:///path/to/cli.mjs:1234:5)';
    const out = formatCallFailure(err);
    expect(out).toContain('at runSend');
    expect(out).toContain('⚠ No terminal is registered for this shell');
  });

  it('still returns just the message for unrelated string rejects', () => {
    const out = formatCallFailure('some-non-Error-reject');
    expect(out).toBe('some-non-Error-reject');
  });

  it('appends the hint when the wedge signature appears in a string reject', () => {
    const out = formatCallFailure('Server-resolved identity required (bare string reject)');
    expect(out).toContain('⚠ No terminal is registered for this shell');
  });

  it('returns "Unknown error." for null/undefined rejects (legacy fallback)', () => {
    expect(formatCallFailure(null)).toBe('Unknown error.');
    expect(formatCallFailure(undefined)).toBe('Unknown error.');
  });
});
