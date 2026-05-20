/**
 * GET /api/terminals/[id]/files → convenience filter that mirrors
 * /api/file-refs?scope=terminal&target=[id]. Lets the CLI
 * `terminal <name> listfiles` shape hit a clean per-terminal URL without
 * re-quoting query params.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listFileRefsForScope } from '$lib/server/fileRefsStore';

export const GET: RequestHandler = async ({ params }) => {
  const sessionId = params.id ?? '';
  if (sessionId.length === 0) throw error(400, 'sessionId required.');
  return json({ fileRefs: listFileRefsForScope('terminal', sessionId) });
};
