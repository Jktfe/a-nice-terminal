import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ant tunnel CLI contract', () => {
  const source = readFileSync(resolve(import.meta.dirname, '../cli/commands/tunnel.ts'), 'utf8');

  it('uses --rooms as the room-token selector when --session is omitted', () => {
    expect(source).toContain('function primaryRoomId(flags: any): string');
    expect(source).toContain('flags.session || flags.room || flags.session_id || firstRoomId(flags.rooms');
    expect(source).toContain('config.getRoomToken(String(roomId))');
  });

  it('documents the room-scoped registration command shape', () => {
    expect(source).toContain('ant tunnel add <slug>');
    expect(source).toContain('--public https://x.trycloudflare.com');
    expect(source).toContain('--rooms room-id');
  });
});
