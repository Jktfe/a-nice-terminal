/**
 * Tests for the Stage B `ant request` CLI verb (plan milestone
 * p3-stage-b-permission-requests of ant-substrate-v0.2-2026-05-29).
 *
 * Covers: usage/help, approve happy path with + without scope,
 * deny with + without reason, list (mine + --approver), show,
 * server-error surfacing, missing-positional errors.
 */
import { describe, expect, it } from 'vitest';
import { handleRequestVerb } from './ant-cli-request.mjs';

class CliInputError extends Error {}

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

function okJson(body, status = 200) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function failure(status, bodyText) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => bodyText
  };
}

describe('handleRequestVerb', () => {
  it('emits usage + returns 1 when invoked with no positional', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    const exit = await handleRequestVerb(undefined, [], runtime, { CliInputError });
    expect(exit).toBe(1);
    expect(captured.stdout.length).toBeGreaterThan(0);
    expect(captured.requests).toHaveLength(0);
  });

  it('emits usage + returns 0 when invoked with help', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    const exit = await handleRequestVerb('help', [], runtime, { CliInputError });
    expect(exit).toBe(0);
    expect(captured.stdout.length).toBeGreaterThan(0);
  });

  it('throws on unknown subcommand', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleRequestVerb('zombie', [], runtime, { CliInputError })
    ).rejects.toBeInstanceOf(CliInputError);
  });

  describe('approve', () => {
    it('POSTs to /approve with pidChain + no scope', async () => {
      const { runtime, captured } = makeRuntime(() =>
        okJson({
          request: { status: 'approved' },
          grant: { grantId: 'gr_xyz' },
          replay: { ready: true, status: 'ready_for_replay', actionId: 'pa_a' }
        })
      );
      const exit = await handleRequestVerb('approve', ['req_abc'], runtime, {
        CliInputError
      });
      expect(exit).toBe(0);
      expect(captured.requests).toHaveLength(1);
      expect(captured.requests[0].url).toBe(
        'http://test.local/api/permission-requests/req_abc/approve'
      );
      expect(captured.requests[0].init.method).toBe('POST');
      const body = JSON.parse(captured.requests[0].init.body);
      expect(body.pidChain).toBeInstanceOf(Array);
      expect(body.decisionScope).toBeUndefined();
      expect(captured.stdout[0]).toContain('Approved req_abc');
      expect(captured.stdout[0]).toContain('gr_xyz');
      expect(captured.stdout.some((line) => line.includes('ready_for_replay'))).toBe(true);
    });

    it('threads --scope=always-for-room into decisionScope', async () => {
      const { runtime, captured } = makeRuntime(() =>
        okJson({ request: {}, grant: { grantId: 'gr_x' }, replay: { status: 'ready_for_replay' } })
      );
      await handleRequestVerb(
        'approve',
        ['req_abc', '--scope', 'always-for-room'],
        runtime,
        { CliInputError }
      );
      const body = JSON.parse(captured.requests[0].init.body);
      expect(body.decisionScope).toBe('always-for-room');
    });

    it('rejects invalid --scope', async () => {
      const { runtime } = makeRuntime(() => okJson({}));
      await expect(
        handleRequestVerb('approve', ['req_x', '--scope', 'forever'], runtime, {
          CliInputError
        })
      ).rejects.toBeInstanceOf(CliInputError);
    });

    it('errors when request_id is missing', async () => {
      const { runtime } = makeRuntime(() => okJson({}));
      await expect(
        handleRequestVerb('approve', [], runtime, { CliInputError })
      ).rejects.toBeInstanceOf(CliInputError);
    });

    it('surfaces server failure on non-2xx', async () => {
      const { runtime, captured } = makeRuntime(() => failure(403, 'not allowed'));
      const exit = await handleRequestVerb('approve', ['req_x'], runtime, {
        CliInputError
      });
      expect(exit).toBe(1);
      expect(captured.stderr[0]).toContain('failed (403)');
    });
  });

  describe('deny', () => {
    it('POSTs to /deny with pidChain', async () => {
      const { runtime, captured } = makeRuntime(() => okJson({ request: {} }));
      const exit = await handleRequestVerb('deny', ['req_q'], runtime, {
        CliInputError
      });
      expect(exit).toBe(0);
      expect(captured.requests[0].url).toBe(
        'http://test.local/api/permission-requests/req_q/deny'
      );
      const body = JSON.parse(captured.requests[0].init.body);
      expect(body.pidChain).toBeInstanceOf(Array);
      expect(body.reason).toBeUndefined();
      expect(captured.stdout[0]).toContain('Denied req_q');
    });

    it('threads --reason into the body', async () => {
      const { runtime, captured } = makeRuntime(() => okJson({ request: {} }));
      await handleRequestVerb(
        'deny',
        ['req_q', '--reason', 'not appropriate'],
        runtime,
        { CliInputError }
      );
      const body = JSON.parse(captured.requests[0].init.body);
      expect(body.reason).toBe('not appropriate');
    });

    it('errors when request_id is missing', async () => {
      const { runtime } = makeRuntime(() => okJson({}));
      await expect(
        handleRequestVerb('deny', [], runtime, { CliInputError })
      ).rejects.toBeInstanceOf(CliInputError);
    });
  });

  describe('list', () => {
    it('GETs the listing endpoint without --approver by default', async () => {
      const { runtime, captured } = makeRuntime(() =>
        okJson({
          requests: [
            {
              requestId: 'req_a',
              requesterHandle: '@speedyc',
              action: 'chat.post',
              targetKind: 'room',
              targetId: 'r1'
            }
          ]
        })
      );
      const exit = await handleRequestVerb('list', [], runtime, { CliInputError });
      expect(exit).toBe(0);
      const calledUrl = new URL(captured.requests[0].url);
      expect(calledUrl.pathname).toBe('/api/permission-requests');
      expect(calledUrl.searchParams.get('asApprover')).toBeNull();
      expect(captured.stdout[0]).toContain('req_a');
      expect(captured.stdout[0]).toContain('@speedyc');
    });

    it('--approver adds asApprover=1 to the query', async () => {
      const { runtime, captured } = makeRuntime(() => okJson({ requests: [] }));
      await handleRequestVerb('list', ['--approver'], runtime, { CliInputError });
      const calledUrl = new URL(captured.requests[0].url);
      expect(calledUrl.searchParams.get('asApprover')).toBe('1');
    });

    it('prints (no pending requests) when list empty', async () => {
      const { runtime, captured } = makeRuntime(() => okJson({ requests: [] }));
      await handleRequestVerb('list', [], runtime, { CliInputError });
      expect(captured.stdout[0]).toContain('no pending');
    });
  });

  describe('show', () => {
    it('renders a structured one-screen summary of the request', async () => {
      const { runtime, captured } = makeRuntime(() =>
        okJson({
          request: {
            requestId: 'req_show',
            requesterHandle: '@speedyc',
            action: 'chat.post',
            targetKind: 'room',
            targetId: 'r1',
            status: 'pending',
            reason: 'no_membership',
            approverHandles: [{ handle: '@jwpk', role: 'room_owner', preferred: true }]
          },
          pendingAction: {
            httpMethod: 'POST',
            httpPath: '/api/chat-rooms/r1/messages',
            replayStatus: 'pending',
            expiresAtMs: 9_999
          }
        })
      );
      const exit = await handleRequestVerb('show', ['req_show'], runtime, {
        CliInputError
      });
      expect(exit).toBe(0);
      const joined = captured.stdout.join('\n');
      expect(joined).toContain('req_show');
      expect(joined).toContain('@speedyc');
      expect(joined).toContain('@jwpk*');
      expect(joined).toContain('POST /api/chat-rooms/r1/messages');
      expect(joined).toContain('pending');
    });

    it('errors when request_id is missing', async () => {
      const { runtime } = makeRuntime(() => okJson({}));
      await expect(
        handleRequestVerb('show', [], runtime, { CliInputError })
      ).rejects.toBeInstanceOf(CliInputError);
    });
  });
});
