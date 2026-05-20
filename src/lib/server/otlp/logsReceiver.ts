/**
 * OTLP-HTTP logs receiver bridge (CLI-HOOK-BRIDGE Phase 4, 2026-05-15).
 *
 * Decodes ExportLogsServiceRequest payloads from an OTel-instrumented CLI
 * (Gemini CLI today; others later) and persists matching log records
 * to cli_hook_events.
 *
 * Filter rule: a log record is persisted iff it has an `event.name`
 * attribute. We accept multiple source CLIs by prefix — `gemini_cli.*`,
 * `claude_cli.*`, `codex_cli.*`, `pi_cli.*` — and partition `source_cli`
 * accordingly. Records without `event.name` are silently skipped
 * (typical for non-event logs like raw stdout / debug traces).
 *
 * Mapping (Gemini-specific):
 *   attributes['session.id']      → session_id
 *   event.name minus 'gemini_cli.' → hook_event_name
 *   attributes['function_name']    → tool_name
 *   attributes['prompt_id']        → tool_use_id (closest pi/codex/claude tool_use_id equivalent)
 *   attributes['approval_mode'] |
 *     attributes['to_mode']        → permission_mode
 *   log_record.body.stringValue +
 *     all attributes + timestamps  → payload JSON
 */

import {
  getExportLogsServiceRequestType,
  getExportLogsServiceResponseType,
  flattenAttributes,
  unwrapAnyValue
} from './logsProto';
import { insertCliHookEvent } from '../cliHookEventsStore';

export type LogsReceiverResult = {
  totalLogRecords: number;
  persistedCount: number;
  skippedNoEventName: number;
  skippedNoSessionId: number;
  errors: number;
};

const CLI_SOURCE_PREFIXES: Record<string, string> = {
  'gemini_cli.': 'gemini',
  'claude_cli.': 'claude-cli-otel',
  'codex_cli.': 'codex-otel',
  'pi_cli.': 'pi-otel'
};

function partitionSourceFromEventName(eventName: string): { sourceCli: string; trimmedEventName: string } {
  for (const [prefix, source] of Object.entries(CLI_SOURCE_PREFIXES)) {
    if (eventName.startsWith(prefix)) {
      return { sourceCli: source, trimmedEventName: eventName.slice(prefix.length) };
    }
  }
  // No known prefix: persist as-is under generic source.
  return { sourceCli: 'otel-unknown', trimmedEventName: eventName };
}

type DecodedLogRecord = {
  time_unix_nano?: number | string;
  observed_time_unix_nano?: number | string;
  severity_number?: number;
  severity_text?: string;
  body?: Record<string, unknown>;
  attributes?: Array<Record<string, unknown>>;
  event_name?: string;
};

export function decodeLogsServiceRequest(bytes: Uint8Array): {
  resource_logs?: Array<{
    resource?: { attributes?: Array<Record<string, unknown>> };
    scope_logs?: Array<{
      scope?: { name?: string; version?: string };
      log_records?: DecodedLogRecord[];
    }>;
  }>;
} {
  const RequestType = getExportLogsServiceRequestType();
  const decoded = RequestType.decode(bytes);
  return RequestType.toObject(decoded, {
    longs: String,
    enums: String,
    defaults: false,
    bytes: Array,
    arrays: true,
    objects: true,
    oneofs: false
  }) as ReturnType<typeof decodeLogsServiceRequest>;
}

export function encodeLogsServiceResponseSuccess(): Uint8Array {
  // OTLP success response: an empty ExportLogsServiceResponse (no
  // partial_success field) is the spec-compliant "all accepted" reply.
  const ResponseType = getExportLogsServiceResponseType();
  const message = ResponseType.create({});
  return ResponseType.encode(message).finish();
}

export function ingestDecodedLogsRequest(decoded: ReturnType<typeof decodeLogsServiceRequest>): LogsReceiverResult {
  const result: LogsReceiverResult = {
    totalLogRecords: 0,
    persistedCount: 0,
    skippedNoEventName: 0,
    skippedNoSessionId: 0,
    errors: 0
  };

  for (const rl of decoded.resource_logs ?? []) {
    const resourceAttributes = flattenAttributes(rl.resource?.attributes);
    for (const sl of rl.scope_logs ?? []) {
      const scopeName = sl.scope?.name ?? '';
      const scopeVersion = sl.scope?.version ?? '';
      for (const lr of sl.log_records ?? []) {
        result.totalLogRecords += 1;
        try {
          const attributes = flattenAttributes(lr.attributes);
          // event.name lives either on the proto `event_name` field (newer)
          // or as an `event.name` attribute (legacy / Gemini today).
          const eventName = (lr.event_name && lr.event_name.length > 0)
            ? lr.event_name
            : (typeof attributes['event.name'] === 'string' ? (attributes['event.name'] as string) : '');
          if (!eventName) { result.skippedNoEventName += 1; continue; }

          const sessionId = typeof attributes['session.id'] === 'string'
            ? (attributes['session.id'] as string)
            : '';
          if (!sessionId) { result.skippedNoSessionId += 1; continue; }

          const { sourceCli, trimmedEventName } = partitionSourceFromEventName(eventName);
          const toolName = (typeof attributes['function_name'] === 'string'
            ? (attributes['function_name'] as string)
            : (typeof attributes['tool_name'] === 'string' ? (attributes['tool_name'] as string) : undefined));
          const toolUseId = (typeof attributes['prompt_id'] === 'string'
            ? (attributes['prompt_id'] as string)
            : undefined);
          const permissionMode = (typeof attributes['approval_mode'] === 'string'
            ? (attributes['approval_mode'] as string)
            : (typeof attributes['to_mode'] === 'string' ? (attributes['to_mode'] as string) : undefined));

          const body = unwrapAnyValue(lr.body as Record<string, unknown> | undefined);
          const payload = {
            body,
            time_unix_nano: lr.time_unix_nano ? String(lr.time_unix_nano) : undefined,
            observed_time_unix_nano: lr.observed_time_unix_nano ? String(lr.observed_time_unix_nano) : undefined,
            severity_number: lr.severity_number,
            severity_text: lr.severity_text,
            scope: { name: scopeName, version: scopeVersion },
            resource_attributes: resourceAttributes,
            attributes
          };

          insertCliHookEvent({
            sourceCli,
            sessionId,
            hookEventName: trimmedEventName,
            toolName,
            toolUseId,
            permissionMode,
            payload
          });
          result.persistedCount += 1;
        } catch {
          result.errors += 1;
        }
      }
    }
  }
  return result;
}
