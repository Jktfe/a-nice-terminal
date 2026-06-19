import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RoomPlansPanel from './RoomPlansPanel.svelte';

describe('RoomPlansPanel', () => {
  it('renders a load failure as an alert instead of an empty plan list', () => {
    const { body } = render(RoomPlansPanel, {
      props: { plans: [], plansFetchFailed: true }
    });

    expect(body).toContain('role="alert"');
    expect(body).toContain('Could not load plans for this room');
    expect(body).not.toContain('No plans attached to this room yet.');
  });
});
