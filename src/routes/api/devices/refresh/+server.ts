/**
 * POST /api/devices/refresh — OSS proxy to the canonical ant-accounts
 * service (symmetric to /api/devices/link).
 *
 * The Mac antchat app and the local `accountSync.ts` refresh loop both
 * call this when a device-token bundle needs to be re-minted. We
 * forward the request to
 * `${ANT_ACCOUNTS_URL ?? 'https://accounts.antonline.dev'}/api/devices/refresh`
 * with full passthrough semantics: bytes-only body, Authorization +
 * Cookie passed through, Set-Cookie returned, 502 on upstream
 * unreachable. See `accountsProxy.ts` for the algorithm.
 */

import type { RequestHandler } from './$types';
import { proxyToAccounts } from '$lib/server/accountsProxy';

export const POST: RequestHandler = ({ request }) =>
  proxyToAccounts(request, '/api/devices/refresh');
