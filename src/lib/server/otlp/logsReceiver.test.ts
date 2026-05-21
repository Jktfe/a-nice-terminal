/**
 * OTLP logs receiver tests (CLI-HOOK-BRIDGE Phase 4, 2026-05-15).
 *
 * Builds a real OTel ExportLogsServiceRequest in memory, encodes to
 * protobuf, decodes via the receiver, and asserts that:
 *  - Records with `event.name` + `session.id` attrs are persisted
 *  - Source-CLI partitioning by prefix works
 *  - Records missing either attribute are skipped
 *  - Promoted columns (tool_name, tool_use_id, permission_mode) are extracted
 *  - The full attributes map survives in the payload blob
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  decodeLogsServiceRequest,
  encodeLogsServiceResponseSuccess,
  ingestDecodedLogsRequest
} from './logsReceiver';
import {
  getExportLogsServiceRequestType
} from './logsProto';
import {
  listCliHookEventsForSession,
  listRecentCliHookEvents,
  resetCliHookEventsStoreForTests
} from '../cliHookEventsStore';
import { resetIdentityDbForTests } from '../db';

let tmpDir: string;
const previousDbEnv = process.env.ANT_FRESH_DB_PATH;

function buildAttribute(key: string, value: string | boolean | number) {
  if (typeof value === 'string') return { key, value: { string_value: value } };
  if (typeof value === 'boolean') return { key, value: { bool_value: value } };
  return { key, value: { int_value: value } };
}

function buildLogRecord(opts: {
  eventName?: string;
  sessionId?: string;
  toolName?: string;
  promptId?: string;
  approvalMode?: string;
  extraAttrs?: Array<{ key: string; value: string | boolean | number }>;
  body?: string;
  timeNs?: string;
}) {
  const attributes: Array<{ key: string; value: { string_value?: string; bool_value?: boolean; int_value?: number } }> = [];
  if (opts.eventName !== undefined) attributes.push(buildAttribute('event.name', opts.eventName));
  if (opts.sessionId !== undefined) attributes.push(buildAttribute('session.id', opts.sessionId));
  if (opts.toolName !== undefined) attributes.push(buildAttribute('function_name', opts.toolName));
  if (opts.promptId !== undefined) attributes.push(buildAttribute('prompt_id', opts.promptId));
  if (opts.approvalMode !== undefined) attributes.push(buildAttribute('approval_mode', opts.approvalMode));
  if (opts.extraAttrs) for (const a of opts.extraAttrs) attributes.push(buildAttribute(a.key, a.value));

  return {
    time_unix_nano: opts.timeNs ?? '1700000000000000000',
    severity_number: 9,
    severity_text: 'INFO',
    body: opts.body ? { string_value: opts.body } : undefined,
    attributes
  };
}

function buildRequest(records: Array<ReturnType<typeof buildLogRecord>>) {
  return {
    resource_logs: [{
      resource: { attributes: [buildAttribute('service.name', 'gemini-cli')] },
      scope_logs: [{
        scope: { name: 'gemini-cli', version: '0.42.0' },
        log_records: records
      }]
    }]
  };
}

function encodePayload(plainRequest: unknown): Uint8Array {
  const RequestType = getExportLogsServiceRequestType();
  const message = RequestType.fromObject(plainRequest as Record<string, unknown>);
  return RequestType.encode(message).finish();
}

describe('OTLP logs receiver', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-otlp-logs-'));
    process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
    resetIdentityDbForTests();
    resetCliHookEventsStoreForTests();
  });

  afterEach(() => {
    resetIdentityDbForTests();
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousDbEnv === undefined) delete process.env.ANT_FRESH_DB_PATH;
    else process.env.ANT_FRESH_DB_PATH = previousDbEnv;
  });

  it('persists a gemini_cli.tool_call record with promoted columns extracted', () => {
    const request = buildRequest([buildLogRecord({
      eventName: 'gemini_cli.tool_call',
      sessionId: 'sess_abc',
      toolName: 'read_file',
      promptId: 'p_001',
      approvalMode: 'auto_accept',
      body: 'Tool call: read_file. Decision: auto_accept. Duration: 42ms.'
    })]);

    const decoded = decodeLogsServiceRequest(encodePayload(request));
    const result = ingestDecodedLogsRequest(decoded);
    expect(result.persistedCount).toBe(1);
    expect(result.totalLogRecords).toBe(1);
    expect(result.errors).toBe(0);

    const rows = listCliHookEventsForSession('sess_abc');
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.source_cli).toBe('gemini');
    expect(row.hook_event_name).toBe('tool_call'); // 'gemini_cli.' prefix stripped
    expect(row.tool_name).toBe('read_file');
    expect(row.tool_use_id).toBe('p_001');
    expect(row.permission_mode).toBe('auto_accept');
    const payload = JSON.parse(row.payload) as { attributes: Record<string, string>; body: string };
    expect(payload.attributes['session.id']).toBe('sess_abc');
    expect(payload.body).toMatch(/Tool call: read_file/);
  });

  it('skips records that lack event.name', () => {
    const request = buildRequest([buildLogRecord({
      sessionId: 'sess_no_event',
      body: 'random log line, no event.name attribute'
    })]);
    const result = ingestDecodedLogsRequest(decodeLogsServiceRequest(encodePayload(request)));
    expect(result.persistedCount).toBe(0);
    expect(result.skippedNoEventName).toBe(1);
    expect(listCliHookEventsForSession('sess_no_event')).toHaveLength(0);
  });

  it('skips records that lack session.id', () => {
    const request = buildRequest([buildLogRecord({
      eventName: 'gemini_cli.tool_call',
      body: 'event.name but no session.id'
    })]);
    const result = ingestDecodedLogsRequest(decodeLogsServiceRequest(encodePayload(request)));
    expect(result.persistedCount).toBe(0);
    expect(result.skippedNoSessionId).toBe(1);
  });

  it('partitions source_cli by event-name prefix', () => {
    const records = [
      buildLogRecord({ eventName: 'gemini_cli.tool_call', sessionId: 's_gem' }),
      buildLogRecord({ eventName: 'codex_cli.tool_call', sessionId: 's_cdx' }),
      buildLogRecord({ eventName: 'pi_cli.tool_call', sessionId: 's_pi' }),
      buildLogRecord({ eventName: 'random.unknown_event', sessionId: 's_unk' })
    ];
    const result = ingestDecodedLogsRequest(decodeLogsServiceRequest(encodePayload(buildRequest(records))));
    expect(result.persistedCount).toBe(4);
    const allRows = listRecentCliHookEvents();
    const bySession: Record<string, string> = {};
    for (const r of allRows) bySession[r.session_id] = r.source_cli;
    expect(bySession['s_gem']).toBe('gemini');
    expect(bySession['s_cdx']).toBe('codex-otel');
    expect(bySession['s_pi']).toBe('pi-otel');
    expect(bySession['s_unk']).toBe('otel-unknown');
  });

  it('captures extra attributes in the payload blob', () => {
    const request = buildRequest([buildLogRecord({
      eventName: 'gemini_cli.api_response',
      sessionId: 'sess_extra',
      extraAttrs: [
        { key: 'model', value: 'gemini-2.0-flash' },
        { key: 'input_tokens', value: 1234 },
        { key: 'success', value: true }
      ]
    })]);
    ingestDecodedLogsRequest(decodeLogsServiceRequest(encodePayload(request)));
    const [row] = listCliHookEventsForSession('sess_extra');
    const payload = JSON.parse(row.payload) as { attributes: Record<string, unknown> };
    expect(payload.attributes['model']).toBe('gemini-2.0-flash');
    expect(payload.attributes['input_tokens']).toBe(1234);
    expect(payload.attributes['success']).toBe(true);
  });

  it('round-trips multiple log records in a single request', () => {
    const request = buildRequest([
      buildLogRecord({ eventName: 'gemini_cli.user_prompt', sessionId: 's1', timeNs: '1000000' }),
      buildLogRecord({ eventName: 'gemini_cli.tool_call', sessionId: 's1', toolName: 'read_file', timeNs: '2000000' }),
      buildLogRecord({ eventName: 'gemini_cli.tool_call', sessionId: 's1', toolName: 'write_file', timeNs: '3000000' }),
      buildLogRecord({ eventName: 'gemini_cli.api_response', sessionId: 's1', timeNs: '4000000' })
    ]);
    const result = ingestDecodedLogsRequest(decodeLogsServiceRequest(encodePayload(request)));
    expect(result.persistedCount).toBe(4);
    expect(listCliHookEventsForSession('s1')).toHaveLength(4);
  });

  it('encodeLogsServiceResponseSuccess produces a valid empty proto body', () => {
    const bytes = encodeLogsServiceResponseSuccess();
    // Empty proto3 message = zero bytes.
    expect(bytes.byteLength).toBe(0);
  });
});
