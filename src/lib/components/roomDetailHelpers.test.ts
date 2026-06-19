import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const navigationMocks = vi.hoisted(() => ({
  invalidateAll: vi.fn(async () => {})
}));

vi.mock('$app/navigation', () => ({
  invalidateAll: navigationMocks.invalidateAll
}));

import { exitFocusForMember } from './roomDetailHelpers';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('roomDetailHelpers focus exit', () => {
  beforeEach(() => {
    navigationMocks.invalidateAll.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('invalidates room data after a successful focus exit', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ wasActive: true }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(exitFocusForMember('room-alpha', '@codex')).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('/api/chat-rooms/room-alpha/focus-mode', {
      method: 'DELETE',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ memberHandle: '@codex' })
    });
    expect(navigationMocks.invalidateAll).toHaveBeenCalledTimes(1);
  });

  it('throws a visible failure message instead of silently swallowing a failed focus exit', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ message: 'Authentication required.' }, 401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(exitFocusForMember('room-alpha', '@codex')).rejects.toThrow(
      'Could not pull @codex out of focus (HTTP 401): Authentication required.'
    );
    expect(navigationMocks.invalidateAll).not.toHaveBeenCalled();
  });

  it('keeps an inline alert in the focus panel for exit failures', () => {
    const source = readFileSync('src/lib/components/RoomDetailFocusPanel.svelte', 'utf8');

    expect(source).toContain('exitFocusError');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Could not pull this member out of focus.');
  });
});
