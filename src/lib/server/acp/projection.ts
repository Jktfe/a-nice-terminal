import { join } from 'path';
import { canonicalJson, sha256Hex } from '../pi-rpc/projection.js';

export type AcpRunEventKind =
  | 'tool_call'
  | 'tool_result'
  | 'agent_prompt'
  | 'approval'
  | 'message'
  | 'progress'
  | 'status';

export type AcpFrameDirection = 'client_to_agent' | 'agent_to_client' | 'unknown';

export interface AcpRawRange {
  start: number;
  end: number;
  line: number;
  sha256: string;
}

export interface AcpJsonRpcMessage {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
  result?: unknown;
  error?: unknown;
}

export interface AcpProjectedRunEvent {
  ts_ms: number;
  source: 'acp';
  trust: 'high';
  kind: AcpRunEventKind;
  text: string;
  payload: Record<string, unknown>;
  raw_ref: string;
  payload_hash: string;
}

export interface AcpTranscriptProjection {
  transcript_sha256: string;
  events: AcpProjectedRunEvent[];
  warnings: Array<{ line: number; reason: string }>;
}

export interface AcpReplaySignature {
  kind: AcpRunEventKind;
  payload_hash: string;
  ts_ms: number;
  raw_ref: string;
}

export interface AcpReplayCheck {
  ok: boolean;
  expected: AcpReplaySignature[];
  actual: AcpReplaySignature[];
  transcript_sha256: string;
}

export interface ProtocolEquivalenceSignature {
  source: 'rpc' | 'acp';
  trust: 'high';
  kind: AcpRunEventKind;
  component_variant: 'tool' | 'prompt' | 'approval' | 'message' | 'progress' | 'status';
}

export interface HermesAcpClientConfig {
  command: 'hermes';
  args: ['acp'];
  ant_session_id: string;
  hermes_profile: string;
  env: Record<string, string>;
}

const RAW_REF_PREFIX = 'acp:';

export function hermesProfileForAntSession(sessionId: string): string {
  const safe = sessionId.replace(/[^A-Za-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 72);
  return `ant-${safe || 'session'}`;
}

export function buildHermesAcpClientConfig(sessionId: string, hermesRoot = join(process.env.HOME || '/tmp', '.hermes')): HermesAcpClientConfig {
  const hermesProfile = hermesProfileForAntSession(sessionId);
  return {
    command: 'hermes',
    args: ['acp'],
    ant_session_id: sessionId,
    hermes_profile: hermesProfile,
    env: {
      HERMES_HOME: join(hermesRoot, 'profiles', hermesProfile),
    },
  };
}

export function encodeAcpRequest(method: string, params?: Record<string, unknown>, id?: string | number): string {
  const body: AcpJsonRpcMessage = { jsonrpc: '2.0', method };
  if (id !== undefined) body.id = id;
  if (params !== undefined) body.params = params;
  return `${JSON.stringify(body)}\n`;
}

export function formatAcpRawRef(range: AcpRawRange): string {
  return `${RAW_REF_PREFIX}bytes=${range.start}-${range.end};line=${range.line};sha256=${range.sha256}`;
}

export function parseAcpRawRef(rawRef: string): AcpRawRange | null {
  if (!rawRef.startsWith(RAW_REF_PREFIX)) return null;
  const fields = new Map<string, string>();
  for (const part of rawRef.slice(RAW_REF_PREFIX.length).split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    fields.set(part.slice(0, eq), part.slice(eq + 1));
  }
  const bytes = fields.get('bytes');
  const line = Number(fields.get('line'));
  const sha = fields.get('sha256') ?? '';
  if (!bytes || !Number.isFinite(line) || !sha) return null;
  const dash = bytes.indexOf('-');
  if (dash === -1) return null;
  const start = Number(bytes.slice(0, dash));
  const end = Number(bytes.slice(dash + 1));
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start) return null;
  return { start, end, line, sha256: sha };
}

export function sliceAcpRawRef(transcript: string | Buffer, rawRef: string): Buffer | null {
  const range = parseAcpRawRef(rawRef);
  if (!range) return null;
  const buf = toBuffer(transcript);
  const slice = buf.subarray(range.start, range.end);
  return sha256Hex(slice) === range.sha256 ? slice : null;
}

export function projectAcpTranscript(rawTranscript: string | Buffer, baseTsMs = 0): AcpTranscriptProjection {
  const transcript = toBuffer(rawTranscript);
  const events: AcpProjectedRunEvent[] = [];
  const warnings: Array<{ line: number; reason: string }> = [];
  let lineNumber = 1;
  let start = 0;

  for (let i = 0; i < transcript.length; i += 1) {
    if (transcript[i] !== 0x0a) continue;
    projectLine(transcript.subarray(start, i + 1), start, i + 1, lineNumber, baseTsMs, events, warnings);
    start = i + 1;
    lineNumber += 1;
  }

  if (start < transcript.length) {
    projectLine(transcript.subarray(start), start, transcript.length, lineNumber, baseTsMs, events, warnings);
  }

  return {
    transcript_sha256: sha256Hex(transcript),
    events,
    warnings,
  };
}

export function replaySignature(event: AcpProjectedRunEvent): AcpReplaySignature {
  return {
    kind: event.kind,
    payload_hash: event.payload_hash,
    ts_ms: event.ts_ms,
    raw_ref: event.raw_ref,
  };
}

export function replaySignatures(events: AcpProjectedRunEvent[]): AcpReplaySignature[] {
  return events.map(replaySignature);
}

export function checkAcpReplay(rawTranscript: string | Buffer, expectedEvents: AcpProjectedRunEvent[], baseTsMs = 0): AcpReplayCheck {
  const projected = projectAcpTranscript(rawTranscript, baseTsMs);
  const expected = replaySignatures(expectedEvents);
  const actual = replaySignatures(projected.events);
  return {
    ok: canonicalJson(expected) === canonicalJson(actual),
    expected,
    actual,
    transcript_sha256: projected.transcript_sha256,
  };
}

export function protocolEquivalenceSignature(event: { source: 'rpc' | 'acp'; trust: 'high'; kind: string }): ProtocolEquivalenceSignature {
  const kind = event.kind as AcpRunEventKind;
  return {
    source: event.source,
    trust: event.trust,
    kind,
    component_variant: componentVariant(kind),
  };
}

export function protocolEquivalenceSignatures(events: Array<{ source: 'rpc' | 'acp'; trust: 'high'; kind: string }>): ProtocolEquivalenceSignature[] {
  return events.map(protocolEquivalenceSignature);
}

export class AcpStreamAdapter {
  private readonly baseTsMs: number;
  private readonly chunks: Buffer[] = [];
  private pending: Buffer = Buffer.alloc(0);
  private pendingOffset = 0;
  private lineNumber = 1;

  constructor(options: { baseTsMs?: number } = {}) {
    this.baseTsMs = options.baseTsMs ?? 0;
  }

  feedStdout(chunk: string | Buffer): AcpProjectedRunEvent[] {
    const buf = toBuffer(chunk);
    if (buf.length === 0) return [];
    this.chunks.push(buf);

    const joined = this.pending.length ? Buffer.concat([this.pending, buf]) : buf;
    const joinedOffset = this.pendingOffset;
    const events: AcpProjectedRunEvent[] = [];
    const warnings: Array<{ line: number; reason: string }> = [];
    let start = 0;

    for (let i = 0; i < joined.length; i += 1) {
      if (joined[i] !== 0x0a) continue;
      projectLine(
        joined.subarray(start, i + 1),
        joinedOffset + start,
        joinedOffset + i + 1,
        this.lineNumber,
        this.baseTsMs,
        events,
        warnings,
      );
      start = i + 1;
      this.lineNumber += 1;
    }

    this.pending = joined.subarray(start);
    this.pendingOffset = joinedOffset + start;
    return events;
  }

  flush(): AcpProjectedRunEvent[] {
    if (this.pending.length === 0) return [];
    const pendingLength = this.pending.length;
    const events: AcpProjectedRunEvent[] = [];
    const warnings: Array<{ line: number; reason: string }> = [];
    projectLine(
      this.pending,
      this.pendingOffset,
      this.pendingOffset + this.pending.length,
      this.lineNumber,
      this.baseTsMs,
      events,
      warnings,
    );
    this.pending = Buffer.alloc(0);
    this.pendingOffset += pendingLength;
    this.lineNumber += 1;
    return events;
  }

  transcript(): Buffer {
    return Buffer.concat(this.chunks);
  }

  transcriptSha256(): string {
    return sha256Hex(this.transcript());
  }

  replay(): AcpTranscriptProjection {
    return projectAcpTranscript(this.transcript(), this.baseTsMs);
  }
}

function projectLine(
  lineBytes: Buffer,
  start: number,
  end: number,
  line: number,
  baseTsMs: number,
  events: AcpProjectedRunEvent[],
  warnings: Array<{ line: number; reason: string }>,
): void {
  const content = trimLineEnding(lineBytes);
  if (content.length === 0) return;

  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push({ line, reason: 'JSON-RPC line is not an object' });
      return;
    }
    record = parsed as Record<string, unknown>;
  } catch {
    warnings.push({ line, reason: 'line is not valid JSON' });
    return;
  }

  const range: AcpRawRange = { start, end, line, sha256: sha256Hex(lineBytes) };
  const event = projectAcpRecord(record, range, baseTsMs + line - 1);
  if (event) events.push(event);
}

export function projectAcpRecord(record: Record<string, unknown>, rawRange: AcpRawRange, fallbackTsMs = 0): AcpProjectedRunEvent | null {
  const { message, direction } = unwrapFrame(record);
  if (!isJsonRpcMessage(message)) return null;

  const method = message.method;
  let kind: AcpRunEventKind | null = null;

  if (method === 'session/prompt') kind = 'agent_prompt';
  else if (method === 'session/request_permission' || method === 'session/requestPermission') kind = 'approval';
  else if (method === 'session/update') {
    const update = updatePayload(message);
    const updateType = updateTypeOf(update);
    if (updateType === 'tool_call') kind = 'tool_call';
    else if (updateType === 'tool_call_update') kind = toolUpdateKind(update);
    else if (updateType === 'agent_message_chunk') kind = 'message';
    else if (updateType === 'user_message_chunk') kind = 'agent_prompt';
    else if (updateType === 'plan' || updateType === 'available_commands_update') kind = 'progress';
  } else if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
    kind = 'status';
  }

  if (!kind) return null;

  const tsMs = timestampMs(message, fallbackTsMs);
  const payload = buildPayload(message, direction, kind, rawRange);
  const payloadHash = sha256Hex(canonicalJson(payload));
  return {
    ts_ms: tsMs,
    source: 'acp',
    trust: 'high',
    kind,
    text: eventText(message, kind),
    payload: {
      ...payload,
      payload_hash: payloadHash,
    },
    raw_ref: formatAcpRawRef(rawRange),
    payload_hash: payloadHash,
  };
}

function unwrapFrame(record: Record<string, unknown>): { message: Record<string, unknown>; direction: AcpFrameDirection } {
  const nested = record.message ?? record.frame ?? record.jsonrpc_message;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    return {
      message: nested as Record<string, unknown>,
      direction: directionOf(record.direction),
    };
  }
  return { message: record, direction: directionOf(record.direction) };
}

function directionOf(value: unknown): AcpFrameDirection {
  if (value === 'client_to_agent' || value === 'stdin' || value === 'client') return 'client_to_agent';
  if (value === 'agent_to_client' || value === 'stdout' || value === 'agent') return 'agent_to_client';
  return 'unknown';
}

function isJsonRpcMessage(record: Record<string, unknown>): record is Record<string, unknown> & AcpJsonRpcMessage {
  const hasMethod = typeof record.method === 'string' && record.method.length > 0;
  const hasResponse = record.id !== undefined && (record.result !== undefined || record.error !== undefined);
  return record.jsonrpc === '2.0' && (hasMethod || hasResponse);
}

function updatePayload(message: AcpJsonRpcMessage): Record<string, unknown> | null {
  const params = message.params;
  if (!params || typeof params !== 'object') return null;
  const update = params.update;
  if (update && typeof update === 'object' && !Array.isArray(update)) return update as Record<string, unknown>;
  return params;
}

function updateTypeOf(update: Record<string, unknown> | null): string | null {
  if (!update) return null;
  return stringField(update, ['sessionUpdate', 'session_update', 'type', 'kind']);
}

function toolUpdateKind(update: Record<string, unknown> | null): AcpRunEventKind {
  const status = stringField(update ?? {}, ['status']);
  if (status === 'completed' || status === 'failed') return 'tool_result';
  return 'tool_call';
}

function buildPayload(
  message: AcpJsonRpcMessage,
  direction: AcpFrameDirection,
  kind: AcpRunEventKind,
  rawRange: AcpRawRange,
): Record<string, unknown> {
  const params = message.params ?? {};
  const update = updatePayload(message);
  const carrier = update ?? params;
  const toolCall = objectField(carrier, ['toolCall', 'tool_call']) ?? carrier;
  const content = contentText(carrier);
  const choices = permissionChoices(carrier);
  const command = stringField(toolCall, ['title', 'command', 'name'])
    ?? stringField(carrier, ['title', 'command', 'name'])
    ?? undefined;

  return {
    acp_method: message.method ?? 'response',
    acp_direction: direction,
    acp_update: updateTypeOf(update) ?? undefined,
    acp_id: message.id ?? undefined,
    session_id: stringField(params, ['sessionId', 'session_id']) ?? undefined,
    kind,
    tool_call_id: stringField(toolCall, ['toolCallId', 'tool_call_id']) ?? stringField(carrier, ['toolCallId', 'tool_call_id']) ?? undefined,
    tool_name: stringField(toolCall, ['name', 'title', 'kind']) ?? undefined,
    command,
    args: objectField(toolCall, ['rawInput', 'raw_input', 'input', 'args', 'arguments']) ?? undefined,
    output: objectField(toolCall, ['rawOutput', 'raw_output']) ?? content ?? undefined,
    question: kind === 'approval' ? permissionQuestion(carrier) : promptText(params) ?? content ?? undefined,
    choices: choices.length ? choices : undefined,
    status: stringField(toolCall, ['status']) ?? stringField(carrier, ['status']) ?? undefined,
    raw_line_sha256: rawRange.sha256,
    raw_line: rawRange.line,
    original: message,
  };
}

function eventText(message: AcpJsonRpcMessage, kind: AcpRunEventKind): string {
  const params = message.params ?? {};
  const update = updatePayload(message);
  const carrier = update ?? params;
  const toolCall = objectField(carrier, ['toolCall', 'tool_call']) ?? carrier;
  if (kind === 'tool_call' || kind === 'tool_result') {
    return stringField(toolCall, ['title', 'name', 'kind'])
      ?? stringField(carrier, ['title', 'name', 'kind'])
      ?? (kind === 'tool_result' ? 'Hermes ACP tool result' : 'Hermes ACP tool call');
  }
  if (kind === 'agent_prompt') return promptText(params) ?? contentText(carrier) ?? 'Hermes ACP prompt';
  if (kind === 'approval') return permissionQuestion(carrier) ?? 'Hermes ACP approval requested';
  if (kind === 'message') return contentText(carrier) ?? 'Hermes ACP message';
  if (kind === 'status') return message.error ? 'Hermes ACP error response' : 'Hermes ACP response';
  return updateTypeOf(update) ?? message.method ?? 'Hermes ACP event';
}

function componentVariant(kind: AcpRunEventKind): ProtocolEquivalenceSignature['component_variant'] {
  if (kind === 'tool_call' || kind === 'tool_result') return 'tool';
  if (kind === 'agent_prompt') return 'prompt';
  if (kind === 'approval') return 'approval';
  if (kind === 'message') return 'message';
  if (kind === 'status') return 'status';
  return 'progress';
}

function promptText(params: Record<string, unknown>): string | null {
  const prompt = params.prompt;
  if (Array.isArray(prompt)) return prompt.map(contentBlockText).filter(Boolean).join('\n') || null;
  if (typeof prompt === 'string' && prompt.trim()) return prompt;
  if (prompt && typeof prompt === 'object') return contentBlockText(prompt as Record<string, unknown>);
  return null;
}

function contentText(record: Record<string, unknown>): string | null {
  const direct = stringField(record, ['text', 'message', 'delta']);
  if (direct) return direct;
  const content = record.content;
  if (Array.isArray(content)) return content.map(contentBlockText).filter(Boolean).join('\n') || null;
  if (content && typeof content === 'object') return contentBlockText(content as Record<string, unknown>);
  if (typeof content === 'string' && content.trim()) return content;
  return null;
}

function contentBlockText(block: Record<string, unknown>): string {
  const nested = block.content;
  if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
    const text = contentBlockText(nested as Record<string, unknown>);
    if (text) return text;
  }
  return stringField(block, ['text', 'title', 'name']) ?? '';
}

function permissionQuestion(record: Record<string, unknown>): string | null {
  const toolCall = objectField(record, ['toolCall', 'tool_call']) ?? record;
  return stringField(record, ['question', 'prompt', 'reason', 'message', 'description'])
    ?? stringField(toolCall, ['title', 'name', 'kind']);
}

function permissionChoices(record: Record<string, unknown>): string[] {
  const options = record.options;
  if (!Array.isArray(options)) return [];
  return options
    .map((option) => {
      if (typeof option === 'string') return option;
      if (option && typeof option === 'object') {
        return stringField(option as Record<string, unknown>, ['name', 'optionId', 'option_id', 'kind']);
      }
      return null;
    })
    .filter((choice): choice is string => Boolean(choice));
}

function timestampMs(record: AcpJsonRpcMessage, fallback: number): number {
  const params = record.params ?? {};
  for (const source of [record as Record<string, unknown>, params]) {
    for (const key of ['ts_ms', 'timestamp_ms', 'time_ms', 'created_at_ms']) {
      const value = source[key];
      if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
    }
    for (const key of ['timestamp', 'time', 'created_at', 'ts']) {
      const value = source[key];
      if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed)) return parsed;
      }
    }
  }
  return fallback;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = stringField(value as Record<string, unknown>, ['text', 'content', 'value', 'name', 'title']);
      if (nested) return nested;
    }
  }
  return null;
}

function objectField(record: Record<string, unknown>, keys: string[]): Record<string, unknown> | null {
  for (const key of keys) {
    const value = record[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  }
  return null;
}

function trimLineEnding(buf: Buffer): Buffer {
  if (buf.length === 0) return buf;
  let end = buf.length;
  if (buf[end - 1] === 0x0a) end -= 1;
  if (end > 0 && buf[end - 1] === 0x0d) end -= 1;
  return buf.subarray(0, end);
}

function toBuffer(value: string | Buffer): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
}
