import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import AwayModeToggle from './AwayModeToggle.svelte';

describe('AwayModeToggle', () => {
  it('renders every persisted away tier including away-phone', () => {
    const { body } = render(AwayModeToggle, {
      props: {
        roomId: 'room_alpha',
        callerHandle: '@JWPK',
        currentMode: 'heads-down',
        currentTier: 'away-phone'
      }
    });

    expect(body).toContain('Working');
    expect(body).toContain('Away from desk');
    expect(body).toContain('Away from office');
    expect(body).toContain('Away from phone');
    expect(body).toContain('User is away from phone; bank decisions and avoid token burn.');
    expect(body).toContain('title="Away from phone — long absence, urgent only"');
    expect(body).toContain('aria-pressed="true"');
  });

  it('keeps the mobile layout usable with four tiers', () => {
    const source = readFileSync('src/lib/components/AwayModeToggle.svelte', 'utf8');

    expect(source).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
    expect(source).toContain('white-space: normal;');
  });
});
