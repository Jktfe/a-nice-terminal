import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('chat participants mobile actions', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ChatParticipants.svelte'),
    'utf8',
  );

  it('does not hide participant management actions behind hover on touch browsers', () => {
    expect(source).toContain('@media (hover: none), (pointer: coarse)');
    expect(source).toContain('.actions-overflow');
    expect(source).toContain('max-width: 220px');
    expect(source).toContain('opacity: 1');
    expect(source).toContain('onclick={() => onRemoveParticipant?.(p.sess)}');
    expect(source).toContain('aria-label="Remove {label} from room"');
  });

  it('gives mobile participant action buttons a larger tap target', () => {
    expect(source).toContain('width: 36px');
    expect(source).toContain('height: 36px');
  });
});
