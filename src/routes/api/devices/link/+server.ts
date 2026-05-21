/**
 * POST /api/devices/link — OSS proxy to the canonical ant-accounts
 * service (M8 device-link bridge for Mac antchat).
 *
 * The Mac antchat app (commit 8575e26) POSTs here immediately after
 * Better Auth login completes. We forward the request to
 * `${ANT_ACCOUNTS_URL ?? 'https://accounts.antonline.dev'}/api/devices/link`
 * with the inbound Authorization/Cookie headers intact and pipe the
 * upstream response back unchanged. See `accountsProxy.ts` for the
 * passthrough algorithm + design notes.
 *
 * No auth gating is applied here. The accounts service is the sole
 * authority on whether the caller may link a device; gating on our side
 * would either duplicate the check or create a desync window. If the
 * upstream is unreachable, the proxy returns 502 (not 500) so callers
 * can tell "network down" from "OSS server crashed."
 */

import type { RequestHandler } from './$types';
import { proxyToAccounts } from '$lib/server/accountsProxy';

export const POST: RequestHandler = ({ request }) =>
  proxyToAccounts(request, '/api/devices/link');
