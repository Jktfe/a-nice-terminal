/**
 * /v1/metrics — OTLP-HTTP metrics stub (CLI-HOOK-BRIDGE Phase 4, 2026-05-15).
 *
 * Stub. See ./traces/+server.ts for rationale. Replace with a decoder
 * when ANT wants to surface Gemini's gemini_cli.token.usage etc. as a
 * first-class signal.
 */

import type { RequestHandler } from './$types';

const EMPTY_PB_BODY = new Uint8Array(0);

export const POST: RequestHandler = async ({ request }) => {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  await request.arrayBuffer().catch(() => undefined);
  if (contentType.startsWith('application/json')) {
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'X-ANT-Metrics-Handler': 'stub' }
    });
  }
  return new Response(EMPTY_PB_BODY, {
    status: 200,
    headers: { 'content-type': 'application/x-protobuf', 'X-ANT-Metrics-Handler': 'stub' }
  });
};
