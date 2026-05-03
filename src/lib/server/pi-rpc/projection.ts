import { createHash } from 'crypto';

export type PiRpcRunEventKind =
  | 'tool_call'
  | 'tool_result'
  | 'agent_prompt'
  | 'approval'
  | 'message'
  | 'progress'
  | 'status';

export interface PiRawRange {
  start: number;
  end: number;
  line: number;
  sha256: string;
}

export interface PiProjectedRunEvent {
  ts_ms: number;
  source: 'rpc';
  trust: 'high';
  kind: PiRpcRunEventKind;
  text: string;
  payload: Record<string, unknown>;
  raw_ref: string;
  payload_hash: string;
}

export interface PiTranscriptProjection {
  transcript_sha256: string;
  events: PiProjectedRunEvent[];
  warnings: Array<{ line: number; reason: string }>;
}

export interface PiReplayCheck {
  ok: boolean;
  expected: PiReplaySignature[];
  actual: PiReplaySignature[];
  transcript_sha256: string;
}

export interface PiReplaySignature {
  kind: PiRpcRunEventKind;
  payload_hash: string;
  ts_ms: number;
  raw_ref: string;
}

const RAW_REF_PREFIX = 'pi-rpc:';

const TOOL_START_TYPES = new Set(['tool_execution_start', 'tool_call', 'tool_start']);
const TOOL_UPDATE_TYPES = new Set(['tool_execution_update', 'tool_update']);
const TOOL_END_TYPES = new Set(['tool_execution_end', 'tool_result', 'tool_end']);
const PROMPT_TYPES = new Set(['prompt', 'input_request', 'question', 'agent_prompt']);
const APPROVAL_TYPES = new Set(['approval_request', 'permission_request', 'tool_approval_request', 'tool_auth']);
const MESSAGE_TYPES = new Set(['message_start', 'message_update', 'message_end', 'assistant_message']);
const PROGRESS_TYPES = new Set(['session', 'agent_start', 'turn_start', 'agent_end', 'turn_end']);

export function sha256Hex(data: string | Buffer | Uint8Array): string {
  return createHash('sha256').update(data).digest('hex');
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalise(value));
}

export function formatPiRawRef(range: PiRawRange): string {
  return `${RAW_REF_PREFIX}bytes=${range.start}-${range.end};line=${range.line};sha256=${range.sha256}`;
}

export function parsePiRawRef(rawRef: string): PiRawRange | null {
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

export function slicePiRawRef(transcript: string | Buffer, rawRef: string): Buffer | null {
  const range = parsePiRawRef(rawRef);
  if (!range) return null;
  const buf = toBuffer(transcript);
  const slice = buf.subarray(range.start, range.end);
  return sha256Hex(slice) === range.sha256 ? slice : null;
}

export function projectPiRpcTranscript(rawTranscript: string | Buffer, baseTsMs = 0): PiTranscriptProjection {
  const transcript = toBuffer(rawTranscript);
  const events: PiProjectedRunEvent[] = [];
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

export function replaySignature(event: PiProjectedRunEvent): PiReplaySignature {
  return {
    kind: event.kind,
    payload_hash: event.payload_hash,
    ts_ms: event.ts_ms,
    raw_ref: event.raw_ref,
  };
}

export function replaySignatures(events: PiProjectedRunEvent[]): PiReplaySignature[] {
  return events.map(replaySignature);
}

export function checkPiRpcReplay(rawTranscript: string | Buffer, expectedEvents: PiProjectedRunEvent[], baseTsMs = 0): PiReplayCheck {
  const projected = projectPiRpcTranscript(rawTranscript, baseTsMs);
  const expected = replaySignatures(expectedEvents);
  const actual = replaySignatures(projected.events);
  return {
    ok: canonicalJson(expected) === canonicalJson(actual),
    expected,
    actual,
    transcript_sha256: projected.transcript_sha256,
  };
}

export function encodePiRpcCommand(command: string, data?: Record<string, unknown>, id?: string | number): string {
  const body: Record<string, unknown> = { command };
  if (id !== undefined) body.id = id;
  if (data !== undefined) body.data = data;
  return `${JSON.stringify(body)}\n`;
}

export class PiRpcStreamAdapter {
  private readonly baseTsMs: number;
  private readonly chunks: Buffer[] = [];
  private pending: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private pendingOffset = 0;
  private lineNumber = 1;

  constructor(options: { baseTsMs?: number } = {}) {
    this.baseTsMs = options.baseTsMs ?? 0;
  }

  feedStdout(chunk: string | Buffer): PiProjectedRunEvent[] {
    const buf = toBuffer(chunk);
    if (buf.length === 0) return [];
    this.chunks.push(buf);

    const joined = this.pending.length ? Buffer.concat([this.pending, buf]) : buf;
    const joinedOffset = this.pendingOffset;
    const events: PiProjectedRunEvent[] = [];
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

  flush(): PiProjectedRunEvent[] {
    if (this.pending.length === 0) return [];
    const pendingLength = this.pending.length;
    const events: PiProjectedRunEvent[] = [];
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

  replay(): PiTranscriptProjection {
    return projectPiRpcTranscript(this.transcript(), this.baseTsMs);
  }
}

function projectLine(
  lineBytes: Buffer,
  start: number,
  end: number,
  line: number,
  baseTsMs: number,
  events: PiProjectedRunEvent[],
  warnings: Array<{ line: number; reason: string }>,
): void {
  const content = trimLineEnding(lineBytes);
  if (content.length === 0) return;

  let record: Record<string, unknown>;
  try {
    const parsed = JSON.parse(content.toString('utf8'));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      warnings.push({ line, reason: 'JSONL value is not an object' });
      return;
    }
    record = parsed as Record<string, unknown>;
  } catch {
    warnings.push({ line, reason: 'line is not valid JSON' });
    return;
  }

  const range: PiRawRange = { start, end, line, sha256: sha256Hex(lineBytes) };
  const event = projectPiRecord(record, range, baseTsMs + line - 1);
  if (event) events.push(event);
}

export function projectPiRecord(record: Record<string, unknown>, rawRange: PiRawRange, fallbackTsMs = 0): PiProjectedRunEvent | null {
  const type = recordType(record);
  if (!type) return null;

  let kind: PiRpcRunEventKind | null = null;
  if (TOOL_START_TYPES.has(type) || TOOL_UPDATE_TYPES.has(type)) kind = 'tool_call';
  else if (TOOL_END_TYPES.has(type)) kind = 'tool_result';
  else if (PROMPT_TYPES.has(type)) kind = 'agent_prompt';
  else if (APPROVAL_TYPES.has(type)) kind = 'approval';
  else if (MESSAGE_TYPES.has(type)) kind = 'message';
  else if (PROGRESS_TYPES.has(type)) kind = 'progress';
  else if (type === 'response' && stringField(record, ['command']) === 'get_state') kind = 'status';
  else return null;

  const tsMs = timestampMs(record, fallbackTsMs);
  const payload = buildPayload(record, type, kind, rawRange);
  const payloadHash = sha256Hex(canonicalJson(payload));
  return {
    ts_ms: tsMs,
    source: 'rpc',
    trust: 'high',
    kind,
    text: eventText(record, type, kind),
    payload: {
      ...payload,
      payload_hash: payloadHash,
    },
    raw_ref: formatPiRawRef(rawRange),
    payload_hash: payloadHash,
  };
}

function recordType(record: Record<string, unknown>): string | null {
  const direct = stringField(record, ['type', 'event_type', 'event']);
  if (direct) return direct;
  return null;
}

function buildPayload(
  record: Record<string, unknown>,
  type: string,
  kind: PiRpcRunEventKind,
  rawRange: PiRawRange,
): Record<string, unknown> {
  const toolName = stringField(record, ['toolName', 'tool_name', 'tool', 'name']);
  const args = objectField(record, ['args', 'arguments', 'input', 'params']);
  const output = record.output ?? record.result ?? record.error ?? null;
  const command = stringField(record, ['command'])
    ?? (typeof args?.command === 'string' ? args.command : null)
    ?? toolName
    ?? undefined;

  return {
    pi_type: type,
    kind,
    tool_name: toolName ?? undefined,
    command,
    args: args ?? undefined,
    output,
    question: stringField(record, ['question', 'prompt']) ?? undefined,
    choices: arrayField(record, ['choices', 'options']) ?? undefined,
    status: stringField(record, ['status', 'phase']) ?? toolPhase(type),
    raw_line_sha256: rawRange.sha256,
    raw_line: rawRange.line,
    original: record,
  };
}

function eventText(record: Record<string, unknown>, type: string, kind: PiRpcRunEventKind): string {
  if (kind === 'tool_call' || kind === 'tool_result') {
    const tool = stringField(record, ['toolName', 'tool_name', 'tool', 'name']) ?? 'tool';
    return `${tool} ${toolPhase(type) ?? 'event'}`;
  }
  if (kind === 'agent_prompt') {
    return stringField(record, ['question', 'prompt', 'text', 'message', 'content']) ?? 'Pi prompt';
  }
  if (kind === 'approval') {
    const question = stringField(record, ['question', 'prompt', 'reason', 'message', 'text']);
    const tool = stringField(record, ['toolName', 'tool_name', 'tool', 'name']);
    return question ?? (tool ? `Approval requested for ${tool}` : 'Pi approval requested');
  }
  if (kind === 'status') return 'Pi state update';
  return stringField(record, ['text', 'message', 'content', 'delta']) ?? type;
}

function toolPhase(type: string): string | undefined {
  if (TOOL_START_TYPES.has(type)) return 'started';
  if (TOOL_UPDATE_TYPES.has(type)) return 'updated';
  if (TOOL_END_TYPES.has(type)) return 'completed';
  return undefined;
}

function timestampMs(record: Record<string, unknown>, fallback: number): number {
  for (const key of ['ts_ms', 'timestamp_ms', 'time_ms', 'created_at_ms']) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  }
  for (const key of ['timestamp', 'time', 'created_at', 'ts']) {
    const value = record[key];
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

function stringField(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const nested = stringField(value as Record<string, unknown>, ['text', 'content', 'value']);
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

function arrayField(record: Record<string, unknown>, keys: string[]): unknown[] | null {
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return null;
}

function trimLineEnding(line: Buffer): Buffer {
  let end = line.length;
  if (end > 0 && line[end - 1] === 0x0a) end -= 1;
  if (end > 0 && line[end - 1] === 0x0d) end -= 1;
  return line.subarray(0, end);
}

function canonicalise(value: unknown): unknown {
  if (value === undefined) return null;
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) return null;
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalise);
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(value as Record<string, unknown>).sort()) {
    out[key] = canonicalise((value as Record<string, unknown>)[key]);
  }
  return out;
}

function toBuffer(input: string | Buffer): Buffer {
  return Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
}
