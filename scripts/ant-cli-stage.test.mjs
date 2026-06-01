import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { handleStageVerb } from './ant-cli-stage.mjs';
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ant stage', () => {
  it('focus publishes a slide focus update with pidChain for agent auth', async () => {
    vi.spyOn(identityChain, 'processIdentityChain').mockReturnValue([{ pid: 42, pid_start: 'agent-start' }]);
    const { runtime, captured } = makeRuntime(() => okJson({
      focus: {
        stageId: 'deck-1',
        ref: 'stage:deck-1:slide:s2',
        label: 'Slide 2: Evidence',
        source: 'plan_event'
      }
    }, 201));

    const code = await handleStageVerb(
      'focus',
      ['deck-1', '--slide-index', '1', '--slide-id', 's2', '--plan', 'stage-primitive-v1', '--json'],
      runtime,
      { CliInputError }
    );

    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/decks/deck-1/stage-focus');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(JSON.parse(captured.requests[0].init.body)).toEqual({
      slideIndex: 1,
      slideId: 's2',
      planId: 'stage-primitive-v1',
      pidChain: [{ pid: 42, pid_start: 'agent-start' }]
    });
    expect(JSON.parse(captured.stdout[0]).focus.label).toBe('Slide 2: Evidence');
  });

  it('current reads the current deck focus with pidChain query auth', async () => {
    vi.spyOn(identityChain, 'processIdentityChain').mockReturnValue([{ pid: 55, pid_start: 'reader-start' }]);
    const { runtime, captured } = makeRuntime(() => okJson({
      focus: { stageId: 'deck-1', ref: 'stage:deck-1:slide:s1', label: 'Slide 1: Intro' }
    }));

    const code = await handleStageVerb('current', ['deck-1'], runtime, { CliInputError });

    expect(code).toBe(0);
    const url = new URL(captured.requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe('http://test.local/api/decks/deck-1/stage-focus');
    expect(JSON.parse(url.searchParams.get('pidChain'))).toEqual([{ pid: 55, pid_start: 'reader-start' }]);
    expect(captured.stdout[0]).toContain('Slide 1: Intro');
  });

  it('main runner dispatch exposes the stage verb', async () => {
    vi.spyOn(identityChain, 'processIdentityChain').mockReturnValue([{ pid: 66, pid_start: 'dispatch-start' }]);
    const calls = [];
    const out = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ focus: { label: 'Slide 1: Intro', ref: 'stage:deck:slide:s1' } }, 201);
      },
      writeOut: (line) => out.push(line),
      writeErr: () => {}
    });

    const code = await runner.run(['stage', 'focus', 'deck-1', '--slide-index', '0']);

    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/decks/deck-1/stage-focus');
    expect(out[0]).toContain('Slide 1: Intro');
  });
});
