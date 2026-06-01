import { beforeEach, describe, expect, it, vi } from 'vitest';
import { roomSidePanelPins } from './roomSidePanelPins.svelte';

function installLocalStorage(): Map<string, string> {
  const storage = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  return storage;
}

describe('roomSidePanelPins', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('hydrates pins per room from localStorage without leaking across rooms', () => {
    const storage = installLocalStorage();
    storage.set('ant.sidepanel.room-a', JSON.stringify(['participants', 'memory']));
    storage.set('ant.sidepanel.room-b', JSON.stringify(['tasks']));

    roomSidePanelPins.init('room-a');
    roomSidePanelPins.init('room-b');

    expect([...roomSidePanelPins.getPinsForRoom('room-a')]).toEqual([
      'participants',
      'memory'
    ]);
    expect([...roomSidePanelPins.getPinsForRoom('room-b')]).toEqual(['tasks']);
  });

  it('persists toggles and removes storage when the final pin is cleared', () => {
    const storage = installLocalStorage();

    roomSidePanelPins.init('room-c');
    roomSidePanelPins.togglePin('room-c', 'asks');
    expect(storage.get('ant.sidepanel.room-c')).toBe('["asks"]');

    roomSidePanelPins.togglePin('room-c', 'asks');
    expect(storage.has('ant.sidepanel.room-c')).toBe(false);
    expect(roomSidePanelPins.getPinsForRoom('room-c').size).toBe(0);
  });
});
