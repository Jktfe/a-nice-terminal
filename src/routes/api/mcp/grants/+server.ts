import { error, json } from '@sveltejs/kit';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { doesChatRoomExist } from '$lib/server/chatRoomStore';
import { createMcpGrant, listMcpGrantsForRoom } from '$lib/server/mcpGrantStore';

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (text.length === 0) throw error(400, 'Body must be a JSON object.');
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (failure) {
    if (failure instanceof SyntaxError) throw error(400, 'Body must be valid JSON.');
    throw failure;
  }
}

function requireString(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw error(400, `Field ${field} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') throw error(400, `Field ${field} must be a string when present.`);
  return value;
}

export const GET = async ({ request, url }: { request: Request; url: URL }) => {
  requireAdminAuth(request);
  const roomId = url.searchParams.get('roomId') ?? '';
  if (roomId.length === 0) throw error(400, 'Query param roomId is required.');
  if (!doesChatRoomExist(roomId)) throw error(404, 'room not found');
  const grants = listMcpGrantsForRoom(roomId, {
    includeRevoked: url.searchParams.get('includeRevoked') === '1'
  });
  return json({ grants });
};

export const POST = async ({ request }: { request: Request }) => {
  requireAdminAuth(request);
  const body = await parseRequiredJsonBody(request);
  const roomId = requireString(body, 'roomId');
  if (!doesChatRoomExist(roomId)) throw error(404, 'room not found');
  const result = createMcpGrant({
    roomId,
    handle: requireString(body, 'handle'),
    label: optionalString(body.label, 'label') ?? null
  });
  return json(result);
};
