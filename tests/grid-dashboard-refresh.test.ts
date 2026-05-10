import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('grid dashboard refresh behaviour', () => {
  const gridSlot = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/GridSlot.svelte'),
    'utf8',
  );

  it('polls grid tiles in the background without flashing loading state', () => {
    expect(gridSlot).toContain('type LoadContentOptions');
    expect(gridSlot).toContain('background?: boolean');
    expect(gridSlot).toContain('if (showLoading) loadingContent = true');
    expect(gridSlot).toContain('{ background: true }');
    expect(gridSlot).toContain('const GRID_POLL_INTERVAL_MS = 10_000');
    expect(gridSlot).toContain('if (typeof document !==');
    expect(gridSlot).toContain('document.hidden');
  });

  it('keeps grid previews light and only updates visible rows when content changes', () => {
    expect(gridSlot).toContain('const GRID_CHAT_PREVIEW_LIMIT = 20');
    expect(gridSlot).toContain('messageFingerprint');
    expect(gridSlot).toContain('terminalFingerprint');
    expect(gridSlot).toContain('setChatMessagesIfChanged');
    expect(gridSlot).toContain('setTerminalLinesIfChanged');
  });

  it('shows room agents directly in grid card headers', () => {
    expect(gridSlot).toContain('/participants');
    expect(gridSlot).toContain('const GRID_PARTICIPANTS_REFRESH_MS = 30_000');
    expect(gridSlot).toContain('class="grid-room-agents"');
    expect(gridSlot).toContain('Room agents:');
    expect(gridSlot).toContain('participantLabel');
  });
});
