/**
 * Inline OTLP logs proto schema (CLI-HOOK-BRIDGE Phase 4, 2026-05-15).
 *
 * Why inline: the alternative is vendoring the opentelemetry-proto repo
 * (6+ .proto files + import wiring). For ANT's narrow need — receive
 * Gemini CLI's log exports and map them onto cli_hook_events — the
 * minimum-viable subset of the OTLP logs schema is small enough to embed
 * here as a string. If we later need traces or metrics decode, add their
 * proto bodies to this file.
 *
 * Source: opentelemetry-proto v1.x at
 *   github.com/open-telemetry/opentelemetry-proto/blob/main/opentelemetry/proto/
 *     collector/logs/v1/logs_service.proto
 *     logs/v1/logs.proto
 *     common/v1/common.proto
 *     resource/v1/resource.proto
 *
 * Trimmed to a single flat schema for protobufjs.parse(). Tag numbers
 * match the OTel spec EXACTLY — these are the wire-format keys.
 */

import protobuf from 'protobufjs';

const OTLP_LOGS_PROTO_SOURCE = `
syntax = "proto3";
package opentelemetry.proto.collector.logs.v1;

message ExportLogsServiceRequest {
  repeated ResourceLogs resource_logs = 1;
}

message ExportLogsServiceResponse {
  ExportLogsPartialSuccess partial_success = 1;
}

message ExportLogsPartialSuccess {
  int64 rejected_log_records = 1;
  string error_message = 2;
}

message ResourceLogs {
  Resource resource = 1;
  repeated ScopeLogs scope_logs = 2;
  string schema_url = 3;
}

message Resource {
  repeated KeyValue attributes = 1;
  uint32 dropped_attributes_count = 2;
}

message ScopeLogs {
  InstrumentationScope scope = 1;
  repeated LogRecord log_records = 2;
  string schema_url = 3;
}

message InstrumentationScope {
  string name = 1;
  string version = 2;
  repeated KeyValue attributes = 3;
  uint32 dropped_attributes_count = 4;
}

message LogRecord {
  fixed64 time_unix_nano = 1;
  fixed64 observed_time_unix_nano = 11;
  int32 severity_number = 2;
  string severity_text = 3;
  AnyValue body = 5;
  repeated KeyValue attributes = 6;
  uint32 dropped_attributes_count = 7;
  uint32 flags = 8;
  bytes trace_id = 9;
  bytes span_id = 10;
  string event_name = 12;
}

message KeyValue {
  string key = 1;
  AnyValue value = 2;
}

message AnyValue {
  oneof value {
    string string_value = 1;
    bool bool_value = 2;
    sint64 int_value = 3;
    double double_value = 4;
    ArrayValue array_value = 5;
    KeyValueList kvlist_value = 6;
    bytes bytes_value = 7;
  }
}

message ArrayValue {
  repeated AnyValue values = 1;
}

message KeyValueList {
  repeated KeyValue values = 1;
}
`;

let _cachedRoot: protobuf.Root | null = null;

function getRoot(): protobuf.Root {
  if (_cachedRoot) return _cachedRoot;
  _cachedRoot = protobuf.parse(OTLP_LOGS_PROTO_SOURCE, { keepCase: true }).root;
  return _cachedRoot;
}

export function getExportLogsServiceRequestType(): protobuf.Type {
  return getRoot().lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceRequest');
}

export function getExportLogsServiceResponseType(): protobuf.Type {
  return getRoot().lookupType('opentelemetry.proto.collector.logs.v1.ExportLogsServiceResponse');
}

export type AttributeValue =
  | string
  | number
  | boolean
  | null
  | AttributeValue[]
  | { [key: string]: AttributeValue };

/**
 * Flatten an OTel `AnyValue` (from a decoded protobuf message) into a
 * plain JS value. Returns null when no oneof field is set.
 */
export function unwrapAnyValue(anyValue: Record<string, unknown> | null | undefined): AttributeValue {
  if (!anyValue || typeof anyValue !== 'object') return null;
  if ('string_value' in anyValue && anyValue.string_value !== undefined) return anyValue.string_value as string;
  if ('bool_value' in anyValue && anyValue.bool_value !== undefined) return anyValue.bool_value as boolean;
  if ('int_value' in anyValue && anyValue.int_value !== undefined) {
    const v = anyValue.int_value;
    if (typeof v === 'string') return Number(v);
    return v as number;
  }
  if ('double_value' in anyValue && anyValue.double_value !== undefined) return anyValue.double_value as number;
  if ('array_value' in anyValue && anyValue.array_value && typeof anyValue.array_value === 'object') {
    const arr = (anyValue.array_value as { values?: unknown[] }).values ?? [];
    return arr.map((v) => unwrapAnyValue(v as Record<string, unknown>));
  }
  if ('kvlist_value' in anyValue && anyValue.kvlist_value && typeof anyValue.kvlist_value === 'object') {
    const kvs = (anyValue.kvlist_value as { values?: unknown[] }).values ?? [];
    return Object.fromEntries(
      kvs.map((kv) => {
        const k = (kv as { key?: string }).key ?? '';
        const v = unwrapAnyValue((kv as { value?: unknown }).value as Record<string, unknown>);
        return [k, v];
      })
    );
  }
  if ('bytes_value' in anyValue && anyValue.bytes_value !== undefined) {
    // Return base64 representation; rare in OTel attributes.
    const b = anyValue.bytes_value;
    if (b instanceof Uint8Array) return Buffer.from(b).toString('base64');
    return String(b);
  }
  return null;
}

/**
 * Flatten a `KeyValue[]` list into a plain `{ [key]: value }` map.
 */
export function flattenAttributes(
  kvs: Array<Record<string, unknown>> | undefined
): Record<string, AttributeValue> {
  if (!kvs) return {};
  const out: Record<string, AttributeValue> = {};
  for (const kv of kvs) {
    const key = (kv.key as string) ?? '';
    if (key.length === 0) continue;
    out[key] = unwrapAnyValue(kv.value as Record<string, unknown>);
  }
  return out;
}
