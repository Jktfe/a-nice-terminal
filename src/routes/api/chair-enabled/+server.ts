/**
 * Chair-enabled toggle endpoint — D1 optionality backend.
 *
 *   GET  /api/chair-enabled                  → 200 { enabled: boolean }
 *   PUT  /api/chair-enabled  { enabled }     → 200 { enabled: boolean }
 *                                            → 400 if body invalid
 *
 * Disabling is an explicit operator action. The Chair function itself
 * keeps its data API (/api/chair/*) accessible; this toggle only governs
 * whether the /chair UI page shows the board or a disabled-state notice.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAggregateReadAuth } from '$lib/server/aggregateReadAuth';
import { isChairEnabled, setChairEnabled } from '$lib/server/chairEnabledStore';
import { resolveCallerTerminalStrict } from '$lib/server/authGate';

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}

export const GET: RequestHandler = ({ request }) => {
  requireAggregateReadAuth(request, '/api/chair-enabled');
  return json({ enabled: isChairEnabled() });
};

export const PUT: RequestHandler = async ({ request }) => {
  const bodyAsObject = await parseRequiredJsonBody(request);
  // M4.4 T2: pidChain-strict gate per Q4 design contract. Chair-enabled
  // PUT is an INSTANCE-scope write surface — same fail-closed treatment as
  // M3.6a-v1 discussions POST but with terminal-only resolution (no room
  // scope for cookie auth). Caller must be a registered terminal.
  resolveCallerTerminalStrict(request, bodyAsObject);
  const enabled = bodyAsObject.enabled;
  if (typeof enabled !== 'boolean') {
    throw error(400, 'enabled must be a boolean.');
  }
  setChairEnabled(enabled);
  return json({ enabled });
};
