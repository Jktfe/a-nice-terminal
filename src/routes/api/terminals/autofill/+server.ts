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
import { requireOperatorLikeAuthAsync } from '$lib/server/operatorLikeAuth';
import { readLiveAutofillSuggestionsForHandle } from '$lib/server/liveAutofillSuggestions';

export const GET: RequestHandler = async ({ request, url }) => {
  await requireOperatorLikeAuthAsync(request, 'authenticated operator session required');
  const handle = url.searchParams.get('handle')?.trim() ?? '';
  if (handle.length === 0) throw error(400, 'query param handle is required');
  const result = readLiveAutofillSuggestionsForHandle(handle);
  return json({
    ...result,
    copyOnly: true,
    ephemeral: true
  });
};
