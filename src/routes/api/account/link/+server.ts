/**
 * POST /api/account/link — OSS proxy to the canonical ant-accounts
 * service. Sister of /api/devices/link (G7); the CLI verb
 * `ant account link` (scripts/ant-cli-account.mjs) hits this path
 * specifically, so we mirror /api/devices/link under the /api/account/*
 * namespace the CLI uses.
 *
 * Forwards to `${ANT_ACCOUNTS_URL ?? 'https://accounts.antonline.dev'}/api/devices/link`
 * via the shared accountsProxy passthrough.
 */

import type { RequestHandler } from './$types';
import { proxyToAccounts } from '$lib/server/accountsProxy';

export const POST: RequestHandler = ({ request }) =>
  proxyToAccounts(request, '/api/devices/link');
