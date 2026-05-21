/**
 * /v1/logs — OTLP-HTTP logs receiver
 * (CLI-HOOK-BRIDGE Phase 4, 2026-05-15, JWPK).
 *
 * Endpoint contract (per OpenTelemetry OTLP/HTTP spec 1.10):
 *   POST /v1/logs
 *     Content-Type: application/x-protobuf  (Gemini CLI default)
 *       Body: serialized ExportLogsServiceRequest
 *     -> 200 application/x-protobuf with empty ExportLogsServiceResponse
 *     -> 400 on decode failure
 *     -> 415 on unsupported content-type
 *
 *   Content-Type: application/json (forward-compat for other clients)
 *     Body: JSON-shaped ExportLogsServiceRequest
 *     -> 200 application/json `{}`
 *
 * Gemini CLI config to push here (in ~/.gemini/settings.json):
 *   {
 *     "telemetry": {
 *       "enabled": true,
 *       "target": "local",
 *       "otlpProtocol": "http",
 *       "otlpEndpoint": "http://localhost:6174",
 *       "logPrompts": true
 *     }
 *   }
 * (Gemini's HTTP exporter appends /v1/logs etc. itself — base URL only.)
 */

import { error, type RequestHandler } from '@sveltejs/kit';
import {
  decodeLogsServiceRequest,
  encodeLogsServiceResponseSuccess,
  ingestDecodedLogsRequest
} from '$lib/server/otlp/logsReceiver';
import { getExportLogsServiceRequestType } from '$lib/server/otlp/logsProto';

const SUCCESS_PROTOBUF_BODY = encodeLogsServiceResponseSuccess();

export const POST: RequestHandler = async ({ request }) => {
  const contentType = (request.headers.get('content-type') ?? '').toLowerCase();

  let decoded: ReturnType<typeof decodeLogsServiceRequest>;
  if (contentType.startsWith('application/x-protobuf')) {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await request.arrayBuffer());
    } catch {
      throw error(400, 'could not read protobuf body');
    }
    try {
      decoded = decodeLogsServiceRequest(bytes);
    } catch (cause) {
      throw error(400, `protobuf decode failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  } else if (contentType.startsWith('application/json')) {
    let jsonBody: unknown;
    try {
      jsonBody = await request.json();
    } catch {
      throw error(400, 'could not parse JSON body');
    }
    try {
      const RequestType = getExportLogsServiceRequestType();
      const message = RequestType.fromObject(jsonBody as Record<string, unknown>);
      decoded = RequestType.toObject(message, { longs: String, defaults: false }) as typeof decoded;
    } catch (cause) {
      throw error(400, `OTLP JSON decode failed: ${cause instanceof Error ? cause.message : String(cause)}`);
    }
  } else {
    throw error(415, `unsupported content-type: ${contentType || '(missing)'}`);
  }

  const result = ingestDecodedLogsRequest(decoded);
  // Stash the result on response headers for diagnostic visibility without
  // breaking the OTLP-HTTP contract (the spec says the body MUST be a
  // serialized ExportLogsServiceResponse; headers are not constrained).
  const diagnosticHeaders: Record<string, string> = {
    'X-ANT-Persisted': String(result.persistedCount),
    'X-ANT-Total': String(result.totalLogRecords),
    'X-ANT-Skipped-NoEvent': String(result.skippedNoEventName),
    'X-ANT-Skipped-NoSession': String(result.skippedNoSessionId),
    'X-ANT-Errors': String(result.errors)
  };

  if (contentType.startsWith('application/json')) {
    return new Response('{}', {
      status: 200,
      headers: { 'content-type': 'application/json', ...diagnosticHeaders }
    });
  }
  // Node 20 TS demands a non-generic Uint8Array for Response body — copy
  // into a fresh ArrayBuffer-backed view.
  const responseBody = new Uint8Array(SUCCESS_PROTOBUF_BODY);
  return new Response(responseBody, {
    status: 200,
    headers: { 'content-type': 'application/x-protobuf', ...diagnosticHeaders }
  });
};
