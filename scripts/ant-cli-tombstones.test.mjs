// Verb tombstones for the identity cutover (kill-list review msg_d55jrfpr95).
import { describe, expect, it } from 'vitest';
import { tombstoneIfCutover, TOMBSTONED_VERBS } from './ant-cli-tombstones.mjs';

function capture() {
  const lines = [];
  return { lines, writeErr: (l) => lines.push(l) };
}

describe('tombstoneIfCutover', () => {
  it('inert when the build is not a cutover build', () => {
    const { lines, writeErr } = capture();
    expect(tombstoneIfCutover(false, 'bind', writeErr)).toBeNull();
    expect(lines).toHaveLength(0);
  });

  it('cutover build: retired verb answers with the tombstone and exit 9', () => {
    const { lines, writeErr } = capture();
    const code = tombstoneIfCutover(true, 'bind', writeErr);
    expect(code).toBe(9);
    const text = lines.join('\n');
    expect(text).toContain('retired at the identity cutover');
    expect(text).toContain(TOMBSTONED_VERBS['bind'].replacement);
  });

  it('unknown verbs are never tombstoned, even in a cutover build', () => {
    const { lines, writeErr } = capture();
    expect(tombstoneIfCutover(true, 'whoami', writeErr)).toBeNull();
    expect(lines).toHaveLength(0);
  });

  it('the kill-list is exactly the blessed four', () => {
    expect(Object.keys(TOMBSTONED_VERBS).sort()).toEqual(['bind', 'identity-keys', 'reclaim', 'rooms post']);
  });
});
