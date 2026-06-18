/**
 * GET /api/terminals/autofill?handle=@claude
 *
 * Live-only suggestion chips for antOS. This intentionally does NOT store,
 * archive, queue, or send anything. It peeks at the source ANThandle's
 * current pane and returns copy-only chips that antOS can insert into the
 * operator's entry box like iPhone keyboard suggestions.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { resolveCallerHandleAnyRoom } from '$lib/server/authGate';
import { readLiveAutofillSuggestionsForHandle } from '$lib/server/liveAutofillSuggestions';

function requireReadAuth(request: Request): void {
  if (resolveCallerHandleAnyRoom(request)) return;
  try {
    requireAdminAuth(request);
    return;
  } catch {
    throw error(401, 'browser-session or admin-bearer required');
  }
}

export const GET: RequestHandler = ({ request, url }) => {
  requireReadAuth(request);
  const handle = url.searchParams.get('handle')?.trim() ?? '';
  if (handle.length === 0) throw error(400, 'query param handle is required');
  const result = readLiveAutofillSuggestionsForHandle(handle);
  return json({
    ...result,
    copyOnly: true,
    ephemeral: true
  });
};
