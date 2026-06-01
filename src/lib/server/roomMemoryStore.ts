/**
 * roomMemoryStore — file-based memory primitive.
 *
 * Writes MD files to a user-configured vault directory.
 * Default: process.env.OBSIDIAN_VAULT_PATH or ~/ObsidianVault/room-memories
 *
 * File shape:
 *   <vault>/room-memories/<memoryID>.md
 *
 * Frontmatter:
 *   ---
 *   memory_id: <uuid>
 *   created_at: <ISO>
 *   linked_rooms: [room_id, ...]
 *   tags: [...]
 *   ---
 *   <markdown body>
 */

import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

export type RoomMemory = {
  memoryId: string;
  createdAt: string;
  linkedRooms: string[];
  tags: string[];
  title: string;
  body: string;
};

function vaultPath(): string {
  const env = process.env.OBSIDIAN_VAULT_PATH;
  if (env) return resolve(env);
  return resolve(join(homedir(), 'ObsidianVault', 'room-memories'));
}

function ensureDir(): void {
  const dir = vaultPath();
  mkdirSync(dir, { recursive: true });
}

function memoryFilePath(memoryId: string): string {
  return join(vaultPath(), `${memoryId}.md`);
}

export function addRoomMemory(
  title: string,
  body: string,
  linkedRooms: string[],
  tags: string[] = []
): RoomMemory {
  ensureDir();
  const memoryId = randomUUID();
  const createdAt = new Date().toISOString();
  const frontmatter = `---
memory_id: ${memoryId}
created_at: ${createdAt}
linked_rooms: [${linkedRooms.map((r) => `'${r}'`).join(', ')}]
tags: [${tags.map((t) => `'${t}'`).join(', ')}]
---

# ${title}

${body}
`;
  writeFileSync(memoryFilePath(memoryId), frontmatter, 'utf-8');
  return { memoryId, createdAt, linkedRooms, tags, title, body };
}

export function listRoomMemories(roomId?: string): RoomMemory[] {
  ensureDir();
  const dir = vaultPath();
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
  const out: RoomMemory[] = [];
  for (const file of files) {
    const memoryId = file.slice(0, -3);
    try {
      const raw = readFileSync(join(dir, file), 'utf-8');
      const memory = parseMemoryFile(raw, memoryId);
      if (!roomId || memory.linkedRooms.includes(roomId)) {
        out.push(memory);
      }
    } catch { /* skip malformed */ }
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getRoomMemory(memoryId: string): RoomMemory | null {
  try {
    const raw = readFileSync(memoryFilePath(memoryId), 'utf-8');
    return parseMemoryFile(raw, memoryId);
  } catch {
    return null;
  }
}

function parseMemoryFile(raw: string, memoryId: string): RoomMemory {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return { memoryId, createdAt: new Date().toISOString(), linkedRooms: [], tags: [], title: 'Untitled', body: raw };
  }
  const fm = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();
  const titleMatch = body.match(/^# (.+)$/m);
  const title = titleMatch ? titleMatch[1].trim() : 'Untitled';

  const linkedRoomsMatch = fm.match(/linked_rooms:\s*\[([^\]]*)\]/);
  const linkedRooms = linkedRoomsMatch
    ? linkedRoomsMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    : [];

  const tagsMatch = fm.match(/tags:\s*\[([^\]]*)\]/);
  const tags = tagsMatch
    ? tagsMatch[1].split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean)
    : [];

  const createdAtMatch = fm.match(/created_at:\s*(.+)/);
  const createdAt = createdAtMatch ? createdAtMatch[1].trim() : new Date().toISOString();

  return { memoryId, createdAt, linkedRooms, tags, title, body: body.replace(/^# .+\n?/m, '').trim() };
}
