import { describe, it, expect, beforeEach } from 'vitest';
import { addRoomMemory, listRoomMemories, getRoomMemory } from './roomMemoryStore';
import { rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('roomMemoryStore', () => {
  const testVault = join(tmpdir(), `ant-room-mem-test-${Date.now()}`);

  beforeEach(() => {
    process.env.OBSIDIAN_VAULT_PATH = testVault;
    try { rmSync(testVault, { recursive: true }); } catch { /* ignore */ }
    mkdirSync(join(testVault, 'room-memories'), { recursive: true });
  });

  it('adds and retrieves a memory', () => {
    const mem = addRoomMemory('Test Title', 'Test body', ['room-a']);
    expect(mem.memoryId).toBeDefined();
    expect(mem.title).toBe('Test Title');

    const retrieved = getRoomMemory(mem.memoryId);
    expect(retrieved).not.toBeNull();
    expect(retrieved!.title).toBe('Test Title');
    expect(retrieved!.linkedRooms).toContain('room-a');
  });

  it('lists memories filtered by room', () => {
    addRoomMemory('A', 'body', ['room-x']);
    addRoomMemory('B', 'body', ['room-y']);
    const list = listRoomMemories('room-x');
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('A');
  });

  it('parses frontmatter correctly', () => {
    const mem = addRoomMemory('Frontmatter Test', 'Content here', ['r1', 'r2'], ['tag1']);
    const retrieved = getRoomMemory(mem.memoryId);
    expect(retrieved!.linkedRooms).toEqual(['r1', 'r2']);
    expect(retrieved!.tags).toContain('tag1');
  });
});
