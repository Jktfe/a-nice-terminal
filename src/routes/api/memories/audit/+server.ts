import { json } from '@sveltejs/kit';
import { buildMemoryAudit } from '$lib/server/memory-audit.js';

export function GET() {
  return json(buildMemoryAudit());
}
