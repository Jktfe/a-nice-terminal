/**
 * /v1/traces — OTLP-HTTP traces stub (CLI-HOOK-BRIDGE Phase 4, 2026-05-15).
 *
 * Gemini CLI's OTLP exporter sends to /v1/logs AND /v1/traces AND /v1/metrics
 * when traces/metrics are enabled. We accept and acknowledge traces with
 * spec-compliant success responses so the CLI doesn't error, but we don't
 * persist them. ANT's signal channel is event-shaped (logs); spans add
 * little observability value beyond their attributes, which the logs path
 * already captures.
 *
 * If you want spans persisted later, replace this stub with a full
 * ExportTraceServiceRequest decoder + ingest pipeline (mirroring logs).
 */

import type { RequestHandler } from './$types';

// Spec quote (OTLP 1.10): "On success, the server response body MUST be
// an empty Export<Signal>ServiceResponse." For protobuf, an empty message
// serialises to zero bytes. For JSON, "{}".
const EMPTY_PB_BODY = new Uint8Array(0);

export const POST: RequestHandler = async ({ request }) => {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();
  // Drain the body so the client doesn't see a connection-reset:
  await request.arrayBuffer().catch(() => undefined);
  if (contentType.startsWith('application/json')) {
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', 'X-ANT-Trace-Handler': 'stub' }
    });
  }
  return new Response(EMPTY_PB_BODY, {
    status: 200,
    headers: { 'content-type': 'application/x-protobuf', 'X-ANT-Trace-Handler': 'stub' }
  });
};
