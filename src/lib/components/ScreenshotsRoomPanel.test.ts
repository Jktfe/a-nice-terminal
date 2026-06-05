import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ScreenshotsRoomPanel', () => {
  it('links thumbnails to the canonical room screenshot upload path', () => {
    const source = readFileSync(new URL('./ScreenshotsRoomPanel.svelte', import.meta.url), 'utf8');

    expect(source).toContain('/uploads/rooms/${shot.room_id}/screenshots/${shot.sha}.png');
    expect(source).not.toContain('/uploads/${shot.room_id}/${shot.sha}.png');
  });
});
