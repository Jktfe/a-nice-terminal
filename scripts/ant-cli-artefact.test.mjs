import { describe, expect, it, vi } from 'vitest';
import { handleArtefactVerb } from './ant-cli-artefact.mjs';
import * as identityChain from './ant-cli-identity-chain.mjs';

class CliInputError extends Error {}

function okJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return responseBuilder(captured.requests.length, { url, init });
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

describe('ant artefact', () => {
  it('add accepts tracker artefacts that point at standalone tracker pages', async () => {
    vi.spyOn(identityChain, 'processIdentityChain').mockReturnValue([{ pid: 42, pid_start: 'agent-start' }]);
    const { runtime, captured } = makeRuntime(() =>
      okJson({ id: 'art_tracker', kind: 'tracker', title: 'GVPL4 test' }, 201)
    );

    const code = await handleArtefactVerb(
      'add',
      [
        '--room', 'room-a',
        '--kind', 'tracker',
        '--title', 'GVPL4 test',
        '--ref-url', '/rooms/room-a/trackers/trk_gvpl4'
      ],
      runtime,
      { CliInputError }
    );

    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/artefacts');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(JSON.parse(captured.requests[0].init.body)).toEqual({
      pidChain: [{ pid: 42, pid_start: 'agent-start' }],
      kind: 'tracker',
      title: 'GVPL4 test',
      refUrl: '/rooms/room-a/trackers/trk_gvpl4',
      summary: null
    });
    expect(captured.stdout[0]).toContain('[tracker]');
  });
});
