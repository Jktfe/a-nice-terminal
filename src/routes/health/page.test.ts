import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import HealthPage from './+page.svelte';

describe('/health page SSR', () => {
  it('renders the page chrome with the room-health title and eyebrow', () => {
    const { body } = render(HealthPage);

    expect(body).toContain('Room health.');
    expect(body).toContain('Diagnostics');
  });

  it('renders the RoomHealthPanel inside the page', () => {
    const { body } = render(HealthPage);

    // RoomHealthPanel's own SSR markup: distinctive class + section heading.
    expect(body).toContain('room-health-panel');
    expect(body).toContain('Room identity health');
  });
});
