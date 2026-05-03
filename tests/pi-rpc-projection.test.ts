import { describe, expect, it } from 'vitest';
import {
  PiRpcStreamAdapter,
  checkPiRpcReplay,
  encodePiRpcCommand,
  parsePiRawRef,
  projectPiRpcTranscript,
  replaySignatures,
  sha256Hex,
  slicePiRawRef,
} from '../src/lib/server/pi-rpc/projection.js';

const BASE_TS = 1_710_000_000_000;

function fixtureTranscript(): string {
  return [
    JSON.stringify({
      type: 'tool_execution_start',
      timestamp_ms: BASE_TS + 1,
      toolName: 'bash',
      args: { command: 'ls -la' },
    }),
    JSON.stringify({
      type: 'prompt',
      timestamp_ms: BASE_TS + 2,
      question: 'Use π test fixture?',
      choices: ['yes', 'no'],
    }),
    JSON.stringify({
      type: 'approval_request',
      timestamp_ms: BASE_TS + 3,
      toolName: 'write',
      question: 'Approve writing the report?',
      args: { path: 'docs/report.md' },
    }),
  ].join('\n') + '\n';
}

describe('Pi RPC transcript projection', () => {
  it('projects tool, prompt, and approval JSONL into high-trust run events with raw byte refs', () => {
    const raw = fixtureTranscript();
    const projection = projectPiRpcTranscript(raw, BASE_TS);

    expect(projection.transcript_sha256).toBe(sha256Hex(Buffer.from(raw, 'utf8')));
    expect(projection.warnings).toEqual([]);
    expect(projection.events.map((event) => ({
      source: event.source,
      trust: event.trust,
      kind: event.kind,
      ts_ms: event.ts_ms,
    }))).toEqual([
      { source: 'rpc', trust: 'high', kind: 'tool_call', ts_ms: BASE_TS + 1 },
      { source: 'rpc', trust: 'high', kind: 'agent_prompt', ts_ms: BASE_TS + 2 },
      { source: 'rpc', trust: 'high', kind: 'approval', ts_ms: BASE_TS + 3 },
    ]);

    let previousEnd = 0;
    const rawBytes = Buffer.from(raw, 'utf8');
    for (const event of projection.events) {
      expect(event.payload_hash).toMatch(/^[0-9a-f]{64}$/);
      const ref = parsePiRawRef(event.raw_ref);
      expect(ref).not.toBeNull();
      expect(ref!.start).toBeGreaterThanOrEqual(previousEnd);
      expect(ref!.end).toBeGreaterThan(ref!.start);
      previousEnd = ref!.end;
      expect(slicePiRawRef(raw, event.raw_ref)?.toString('utf8')).toBe(
        rawBytes.subarray(ref!.start, ref!.end).toString('utf8'),
      );
    }
  });

  it('replays from raw offsets with identical count, kinds, payload hashes, timestamps, and ranges', () => {
    const raw = fixtureTranscript();
    const live = projectPiRpcTranscript(raw, BASE_TS);
    const replay = checkPiRpcReplay(raw, live.events, BASE_TS);

    expect(replay.ok).toBe(true);
    expect(replay.transcript_sha256).toBe(live.transcript_sha256);
    expect(replay.actual).toEqual(replay.expected);
    expect(replay.actual).toEqual(replaySignatures(live.events));
  });

  it('handles stream chunk boundaries without changing replay signatures', () => {
    const raw = fixtureTranscript();
    const adapter = new PiRpcStreamAdapter({ baseTsMs: BASE_TS });
    const events = [
      ...adapter.feedStdout(raw.slice(0, 17)),
      ...adapter.feedStdout(raw.slice(17, 81)),
      ...adapter.feedStdout(raw.slice(81)),
      ...adapter.flush(),
    ];

    expect(adapter.transcriptSha256()).toBe(sha256Hex(Buffer.from(raw, 'utf8')));
    expect(replaySignatures(events)).toEqual(replaySignatures(projectPiRpcTranscript(raw, BASE_TS).events));
  });

  it('does not turn stdin commands or malformed lines into high-trust Pi events', () => {
    const command = encodePiRpcCommand('get_state', { includePending: true }, 'state-1');
    const response = JSON.stringify({
      type: 'response',
      command: 'get_state',
      data: { isStreaming: false, model: { id: 'pi-test' } },
    });
    const projection = projectPiRpcTranscript(`${command}not json\n${response}\n`, BASE_TS);

    expect(JSON.parse(command)).toEqual({
      command: 'get_state',
      id: 'state-1',
      data: { includePending: true },
    });
    expect(projection.warnings).toEqual([{ line: 2, reason: 'line is not valid JSON' }]);
    expect(projection.events).toHaveLength(1);
    expect(projection.events[0]).toMatchObject({
      kind: 'status',
      source: 'rpc',
      trust: 'high',
      text: 'Pi state update',
    });
  });
});
