import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import RoomTasksPanel from './RoomTasksPanel.svelte';

describe('RoomTasksPanel', () => {
  it('renders a load failure as an alert instead of an empty task list', () => {
    const { body } = render(RoomTasksPanel, {
      props: { tasks: [], tasksFetchFailed: true }
    });

    expect(body).toContain('role="alert"');
    expect(body).toContain('Could not load tasks for this room');
    expect(body).not.toContain('No tasks in this room yet.');
  });
});
