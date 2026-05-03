import { describe, expect, it } from 'vitest';
import {
  AcpStreamAdapter,
  buildHermesAcpClientConfig,
  checkAcpReplay,
  encodeAcpRequest,
  parseAcpRawRef,
  projectAcpTranscript,
  protocolEquivalenceSignatures,
  replaySignatures as acpReplaySignatures,
  sliceAcpRawRef,
} from '../src/lib/server/acp/projection.js';
import {
  projectPiRpcTranscript,
  replaySignatures as piReplaySignatures,
  sha256Hex,
} from '../src/lib/server/pi-rpc/projection.js';

const BASE_TS = 1_710_000_000_000;

function hermesAcpFixtureTranscript(): string {
  return [
    JSON.stringify({
      jsonrpc: '2.0',
      method: 'session/update',
      params: {
        sessionId: 'hermes-session-1',
        timestamp_ms: BASE_TS + 1,
        update: {
          sessionUpdate: 'tool_call',
          toolCallId: 'call-1',
          title: 'terminal: echo hello',
          kind: 'execute',
          status: 'pending',
          rawInput: { command: 'echo hello' },
        },
      },
    }),
    JSON.stringify({
      direction: 'client_to_agent',
      message: {
        jsonrpc: '2.0',
        id: 2,
        method: 'session/prompt',
        params: {
          sessionId: 'hermes-session-1',
          timestamp_ms: BASE_TS + 2,
          prompt: [{ type: 'text', text: 'Continue with the fixture?' }],
        },
      },
    }),
    JSON.stringify({
      jsonrpc: '2.0',
      id: 5,
      method: 'session/request_permission',
      params: {
        sessionId: 'hermes-session-1',
        timestamp_ms: BASE_TS + 3,
        toolCall: {
          toolCallId: 'call-2',
          title: 'write: docs/report.md',
          kind: 'edit',
          rawInput: { path: 'docs/report.md' },
        },
        options: [
          { optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' },
          { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' },
        ],
      },
    }),
  ].join('\n') + '\n';
}

function piFixtureTranscript(): string {
  return [
    JSON.stringify({
      type: 'tool_execution_start',
      timestamp_ms: BASE_TS + 1,
      toolName: 'terminal',
      args: { command: 'echo hello' },
    }),
    JSON.stringify({
      type: 'prompt',
      timestamp_ms: BASE_TS + 2,
      question: 'Continue with the fixture?',
      choices: ['yes', 'no'],
    }),
    JSON.stringify({
      type: 'approval_request',
      timestamp_ms: BASE_TS + 3,
      toolName: 'write_file',
      question: 'Approve writing docs/report.md?',
      args: { path: 'docs/report.md' },
    }),
  ].join('\n') + '\n';
}

describe('Hermes ACP transcript projection', () => {
  it('projects ACP JSON-RPC into high-trust run events with raw byte refs', () => {
    const raw = hermesAcpFixtureTranscript();
    const projection = projectAcpTranscript(raw, BASE_TS);

    expect(projection.transcript_sha256).toBe(sha256Hex(Buffer.from(raw, 'utf8')));
    expect(projection.warnings).toEqual([]);
    expect(projection.events.map((event) => ({
      source: event.source,
      trust: event.trust,
      kind: event.kind,
      ts_ms: event.ts_ms,
    }))).toEqual([
      { source: 'acp', trust: 'high', kind: 'tool_call', ts_ms: BASE_TS + 1 },
      { source: 'acp', trust: 'high', kind: 'agent_prompt', ts_ms: BASE_TS + 2 },
      { source: 'acp', trust: 'high', kind: 'approval', ts_ms: BASE_TS + 3 },
    ]);

    let previousEnd = 0;
    const rawBytes = Buffer.from(raw, 'utf8');
    for (const event of projection.events) {
      expect(event.payload_hash).toMatch(/^[0-9a-f]{64}$/);
      const ref = parseAcpRawRef(event.raw_ref);
      expect(ref).not.toBeNull();
      expect(ref!.start).toBeGreaterThanOrEqual(previousEnd);
      expect(ref!.end).toBeGreaterThan(ref!.start);
      previousEnd = ref!.end;
      expect(sliceAcpRawRef(raw, event.raw_ref)?.toString('utf8')).toBe(
        rawBytes.subarray(ref!.start, ref!.end).toString('utf8'),
      );
    }
  });

  it('replays from raw offsets with identical count, kinds, payload hashes, timestamps, and ranges', () => {
    const raw = hermesAcpFixtureTranscript();
    const live = projectAcpTranscript(raw, BASE_TS);
    const replay = checkAcpReplay(raw, live.events, BASE_TS);

    expect(replay.ok).toBe(true);
    expect(replay.transcript_sha256).toBe(live.transcript_sha256);
    expect(replay.actual).toEqual(replay.expected);
    expect(replay.actual).toEqual(acpReplaySignatures(live.events));
  });

  it('handles stream chunk boundaries without changing replay signatures', () => {
    const raw = hermesAcpFixtureTranscript();
    const adapter = new AcpStreamAdapter({ baseTsMs: BASE_TS });
    const events = [
      ...adapter.feedStdout(raw.slice(0, 31)),
      ...adapter.feedStdout(raw.slice(31, 197)),
      ...adapter.feedStdout(raw.slice(197)),
      ...adapter.flush(),
    ];

    expect(adapter.transcriptSha256()).toBe(sha256Hex(Buffer.from(raw, 'utf8')));
    expect(acpReplaySignatures(events)).toEqual(acpReplaySignatures(projectAcpTranscript(raw, BASE_TS).events));
  });

  it('normalises Pi RPC and Hermes ACP fixtures to the same component variants', () => {
    const pi = projectPiRpcTranscript(piFixtureTranscript(), BASE_TS).events;
    const acp = projectAcpTranscript(hermesAcpFixtureTranscript(), BASE_TS).events;
    const piSignatures = protocolEquivalenceSignatures(pi);
    const acpSignatures = protocolEquivalenceSignatures(acp);
    const withoutSource = (signature: { source: string }) => {
      const { source: _source, ...rest } = signature;
      return rest;
    };

    expect(piReplaySignatures(pi).map((event) => event.kind)).toEqual(['tool_call', 'agent_prompt', 'approval']);
    expect(piSignatures.map((event) => event.source)).toEqual(['rpc', 'rpc', 'rpc']);
    expect(acpSignatures.map((event) => event.source)).toEqual(['acp', 'acp', 'acp']);
    expect(piSignatures.map(withoutSource)).toEqual(acpSignatures.map(withoutSource));
  });

  it('maps one ANT session to one Hermes ACP profile and encodes client requests', () => {
    const first = buildHermesAcpClientConfig('sn/one');
    const same = buildHermesAcpClientConfig('sn/one');
    const other = buildHermesAcpClientConfig('sn/two');
    const prompt = encodeAcpRequest('session/prompt', {
      sessionId: 'hermes-session-1',
      prompt: [{ type: 'text', text: 'hello' }],
    }, 2);

    expect(first.command).toBe('hermes');
    expect(first.args).toEqual(['acp']);
    expect(first.hermes_profile).toBe(same.hermes_profile);
    expect(first.hermes_profile).not.toBe(other.hermes_profile);
    expect(first.env.HERMES_HOME).toContain(`/profiles/${first.hermes_profile}`);
    expect(JSON.parse(prompt)).toMatchObject({
      jsonrpc: '2.0',
      id: 2,
      method: 'session/prompt',
      params: { sessionId: 'hermes-session-1' },
    });
  });

  it('does not turn malformed or unrelated JSON-RPC lines into high-trust ACP events', () => {
    const raw = [
      'not json',
      JSON.stringify({ jsonrpc: '2.0', method: 'window/logMessage', params: { message: 'debug' } }),
    ].join('\n') + '\n';
    const projection = projectAcpTranscript(raw, BASE_TS);

    expect(projection.warnings).toEqual([{ line: 1, reason: 'line is not valid JSON' }]);
    expect(projection.events).toEqual([]);
  });
});
