// CLI presents its pane as a transport fact (contract step 3, blessed
// msg_6dtpw2o4pn: "the CLI never resolves identity; it presents pane/pidChain
// facts for the daemon to verify"). whoami includes TMUX_PANE when the shell
// has one; older shells / non-tmux contexts simply omit it.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleWhoamiVerb } from './ant-cli-whoami.mjs';

function okJson(body, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function makeRuntime(responseQueue) {
  const captured = { calls: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init) => {
    captured.calls.push({ url, init });
    return responseQueue.shift();
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://fresh.test',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

const boundPayload = { status: 'bound', handle: '@x', terminalId: 't_1', pidChain: [1] };

const prevPane = process.env.TMUX_PANE;

beforeEach(() => { delete process.env.TMUX_PANE; });

afterEach(() => {
  if (prevPane === undefined) delete process.env.TMUX_PANE;
  else process.env.TMUX_PANE = prevPane;
});

describe('ant whoami — pane fact presentation', () => {
  it('includes pane in the request body when TMUX_PANE is set', async () => {
    process.env.TMUX_PANE = '%41';
    const { runtime, captured } = makeRuntime([okJson(boundPayload)]);
    const code = await handleWhoamiVerb(undefined, ['--quiet'], runtime);
    expect(code).toBe(0);
    const body = JSON.parse(captured.calls[0].init.body);
    expect(body.pane).toBe('%41');
    expect(Array.isArray(body.pids)).toBe(true);
  });

  it('omits pane entirely when TMUX_PANE is unset', async () => {
    const { runtime, captured } = makeRuntime([okJson(boundPayload)]);
    const code = await handleWhoamiVerb(undefined, ['--quiet'], runtime);
    expect(code).toBe(0);
    const body = JSON.parse(captured.calls[0].init.body);
    expect('pane' in body).toBe(false);
  });
});
