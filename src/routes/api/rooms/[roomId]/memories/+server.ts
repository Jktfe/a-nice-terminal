import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireChatRoomMutationAuth } from '$lib/server/chatRoomAuthGate';
import { findChatRoomById } from '$lib/server/chatRoomStore';
import { requireChatRoomReadAccess } from '$lib/server/chatRoomReadGate';
import { listRoomMemories, addRoomMemory } from '$lib/server/roomMemoryStore';
import { listMemoriesForScope } from '$lib/server/memoriesStore';
import { resolveMemoryVaultPath } from '$lib/server/memoryVaultSettingsStore';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

type RoomMemoryResponse = {
  memoryId: string;
  createdAt: string;
  linkedRooms: string[];
  tags: string[];
  title: string;
  body: string;
  source?: 'file' | 'key-value' | 'memory-pack';
  href?: string;
};

function keyValueRoomMemoryToResponse(roomId: string, memory: ReturnType<typeof listMemoriesForScope>[number]): RoomMemoryResponse {
  return {
    memoryId: memory.key,
    createdAt: new Date(memory.updatedAtMs).toISOString(),
    linkedRooms: [roomId],
    tags: ['key-value-memory'],
    title: memory.key,
    body: memory.value,
    source: 'key-value'
  };
}

function parseFrontmatterArray(frontmatter: string, field: string): string[] {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*\\[([^\\]]*)\\]\\s*$`, 'm'));
  if (!match) return [];
  return match[1]
    .split(',')
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseFrontmatterValue(frontmatter: string, field: string): string | null {
  const match = frontmatter.match(new RegExp(`^${field}:\\s*["']?([^"'\\n]+)["']?\\s*$`, 'm'));
  return match?.[1]?.trim() ?? null;
}

function memoryAppliesToRoom(frontmatter: string, linkedRooms: string[], roomId: string): boolean {
  if (linkedRooms.includes(roomId)) return true;
  const defaultRoomPolicy = parseFrontmatterValue(frontmatter, 'default_room_policy');
  if (defaultRoomPolicy === 'universal') return true;
  const scope = parseFrontmatterValue(frontmatter, 'scope');
  if (scope === 'universal') return true;
  const type = parseFrontmatterValue(frontmatter, 'type');
  return type === 'core';
}

function walkMarkdownFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const out: string[] = [];
  for (const name of readdirSync(root)) {
    if (name === '.git' || name === 'node_modules') continue;
    const filePath = join(root, name);
    const stat = statSync(filePath);
    if (stat.isDirectory()) out.push(...walkMarkdownFiles(filePath));
    else if (stat.isFile() && name.endsWith('.md')) out.push(filePath);
  }
  return out;
}

function memoryPackFileToResponse(filePath: string, roomId: string): RoomMemoryResponse | null {
  const raw = readFileSync(filePath, 'utf-8');
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) return null;
  const frontmatter = frontmatterMatch[1];
  const bodyWithTitle = frontmatterMatch[2].trim();
  const linkedRooms = parseFrontmatterArray(frontmatter, 'linked_rooms');
  if (!memoryAppliesToRoom(frontmatter, linkedRooms, roomId)) return null;

  const memoryId = parseFrontmatterValue(frontmatter, 'memory_id') ?? filePath.split('/').pop()?.replace(/\.md$/, '') ?? 'memory';
  const title = bodyWithTitle.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? memoryId;
  const body = bodyWithTitle.replace(/^#\s+.+\n?/m, '').trim();
  return {
    memoryId,
    createdAt: parseFrontmatterValue(frontmatter, 'created_at') ?? '1970-01-01T00:00:00.000Z',
    linkedRooms,
    tags: parseFrontmatterArray(frontmatter, 'tags'),
    title,
    body,
    source: 'memory-pack',
    href: `/memory?q=${encodeURIComponent(memoryId)}`
  };
}

function listMemoryPackRoomMemories(roomId: string): RoomMemoryResponse[] {
  const root = resolveMemoryVaultPath();
  if (!root) return [];
  return walkMarkdownFiles(root)
    .map((filePath) => memoryPackFileToResponse(filePath, roomId))
    .filter((memory): memory is RoomMemoryResponse => memory !== null);
}

export const GET: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId;
  if (!roomId) throw error(400, 'roomId required');
  const room = findChatRoomById(roomId);
  if (!room) throw error(404, 'Room not found.');
  await requireChatRoomReadAccess(request, room);
  const fileMemories: RoomMemoryResponse[] = listRoomMemories(roomId).map((memory) => ({
    ...memory,
    source: 'file'
  }));
  const memoryPackMemories = listMemoryPackRoomMemories(roomId);
  const keyValueMemories = listMemoriesForScope('room', roomId)
    .map((memory) => keyValueRoomMemoryToResponse(roomId, memory));
  const memories = [...fileMemories, ...memoryPackMemories, ...keyValueMemories]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return json({ roomId, memories });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const roomId = params.roomId;
  if (!roomId) throw error(400, 'roomId required');
  const payload = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  if (!findChatRoomById(roomId)) throw error(404, 'Room not found.');
  requireChatRoomMutationAuth(roomId, request, payload);
  const title = typeof payload.title === 'string' ? payload.title : 'Untitled';
  const body = typeof payload.body === 'string' ? payload.body : '';
  const tags = Array.isArray(payload.tags) ? payload.tags.filter((t): t is string => typeof t === 'string') : [];

  const memory = addRoomMemory(title, body, [roomId], tags);
  return json({ memory }, { status: 201 });
};
