import { describe, expect, it } from 'vitest';
import { runAuthCutoverCheck } from './check-auth-cutover.mjs';

const WARNING_HEADER = 'warning;route=probe;cutover=2026-05-28T00:00:00.000Z';
const okJson = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
// Use null body (not empty string) so 204/304 status codes pass the
// "null-body status MUST have a null body" check in newer Response
// constructors (vitest/undici post-2026-05).
const empty = (status, headers = {}) => new Response(null, { status, headers });

function makeRuntime(mode) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    const index = captured.requests.length;
    if (index === 1) return okJson({ chatRoom: { id: 'room-probe' } }, 201);
    if (mode === 'warning') {
      if (index === 2) return okJson({ message: { id: 'msg-parent' } }, 201, { 'x-auth-deprecation': WARNING_HEADER });
      if (index === 3) return okJson({ chatRoom: { id: 'room-probe' } }, 201, { 'x-auth-deprecation': WARNING_HEADER });
      if (index === 4) return empty(204, { 'x-auth-deprecation': WARNING_HEADER });
      if (index === 5) return empty(403);
    }
    if (mode === 'strict') {
      if (index === 2 || index === 3 || index === 4) return empty(403);
    }
    return empty(500);
  };
  return {
    captured,
    runner: (argv) => runAuthCutoverCheck({
      argv,
      fetchImpl,
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    })
  };
}

function bodyAt(captured, index) {
  return JSON.parse(captured.requests[index].init.body);
}

describe('check-auth-cutover live probe runner', () => {
  it('reports warning mode when legacy writes return 201/204 with X-Auth-Deprecation', async () => {
    const { captured, runner } = makeRuntime('warning');
    await expect(runner(['--expect', 'warning', '--json'])).resolves.toBe(0);
    const summary = JSON.parse(captured.stdout[0]);
    expect(summary.mode).toBe('warning');
    expect(summary.deprecatedWrites.map((p) => p.label)).toEqual(['messages-post', 'members-post', 'members-delete']);
    expect(summary.discussionsStrictOnly).toMatchObject({ label: 'discussions-post', status: 403, ok: true });
    expect(bodyAt(captured, 1)).toMatchObject({ authorHandle: '@legacy-probe' });
  });

  it('reports strict mode when legacy writes return 403', async () => {
    const { captured, runner } = makeRuntime('strict');
    await expect(runner(['--expect', 'strict'])).resolves.toBe(0);
    expect(captured.stdout[0]).toBe('auth cutover mode: strict');
    expect(captured.stdout.join('\n')).toContain('messages-post\t403\tstrict');
    expect(captured.stdout.join('\n')).toContain('discussions-post\tskipped\tstrict-only');
  });

  it('fails when observed mode does not match --expect', async () => {
    const { runner } = makeRuntime('warning');
    await expect(runner(['--expect', 'strict'])).rejects.toThrow('expected strict mode but observed warning');
  });

  it('uses DELETE JSON body for the remove-member probe', async () => {
    const { captured, runner } = makeRuntime('warning');
    await runner(['--expect', 'warning']);
    expect(captured.requests[3].init.method).toBe('DELETE');
    expect(captured.requests[3].url).toContain('globalHandle=%40cutover-agent-');
    expect(bodyAt(captured, 3)).toEqual({});
  });
});
