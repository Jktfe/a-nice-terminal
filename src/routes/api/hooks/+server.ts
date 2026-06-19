/**
 * /api/hooks — legacy compatibility shim for CLI hook senders.
 *
 * Older hook installers and third-party snippets sometimes posted to
 * /api/hooks while ANT's real lifecycle receiver is /api/cli-hook. The old
 * route returned 204 and dropped the body, which made misconfiguration look
 * successful while ANT recorded nothing. Delegate POSTs to /api/cli-hook
 * instead so valid events are captured and invalid events fail loudly.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { POST as cliHookPost } from '../cli-hook/+server';

function legacyUrl(url: URL): URL {
  const rewritten = new URL(url);
  rewritten.pathname = '/api/cli-hook';
  if (!rewritten.searchParams.has('source')) {
    rewritten.searchParams.set('source', 'legacy-hooks');
  }
  return rewritten;
}

export const POST: RequestHandler = (event) => {
  const cliHookEvent = { ...event, url: legacyUrl(event.url) } as unknown as Parameters<typeof cliHookPost>[0];
  return cliHookPost(cliHookEvent);
};

export const GET: RequestHandler = () => {
  return json({
    message: '/api/hooks is a legacy alias. Configure hook clients to POST lifecycle JSON to /api/cli-hook.',
    receiver: '/api/cli-hook'
  });
};
