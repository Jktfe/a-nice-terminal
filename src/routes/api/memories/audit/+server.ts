import { json } from '@sveltejs/kit';
import { buildMemoryAudit } from '$lib/server/memory-audit.js';
import { assertNotRoomScoped } from '$lib/server/room-scope.js';
import type { RequestEvent } from '@sveltejs/kit';

export function GET(event: RequestEvent) {
  assertNotRoomScoped(event);
  return json(buildMemoryAudit());
}
