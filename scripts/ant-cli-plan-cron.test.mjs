import { describe, expect, it } from 'vitest';
import { handlePlanVerb } from './ant-cli-plan.mjs';

class CliInputError extends Error {}

function makeJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function makeRuntime(handler) {
  const captured = { requests: [], stdout: [] };
  const runtime = {
    serverUrl: 'http://test.local',
    fetchImpl: async (url, init = {}) => {
      captured.requests.push({ url, init });
      return handler(url, init);
    },
    writeOut: (line) => captured.stdout.push(line),
    writeErr: () => {}
  };
  return { runtime, captured };
}

const SAMPLE_JOB = {
  id: 'cron_123',
  name: 'Goal loop',
  status: 'running',
  intervalMs: 600_000,
  action: 'room.message',
  targetRoomId: 'zj4jlety9q',
  targetMessageTemplate: '/loop progress toward /goal 100%',
  createdByHandle: '@evolveantcodex',
  fireCount: 0,
  nextFireAtMs: 1_779_221_000_000
};

describe('ant plan cron CLI verbs', () => {
  it('creates a named cron job with minute interval and starts it immediately', async () => {
    const { runtime, captured } = makeRuntime((_url, init) => makeJsonResponse({ job: SAMPLE_JOB }, 201));

    const code = await handlePlanVerb('cron', [
      'create',
      '--name', 'Goal loop',
      '--every-minutes', '10',
      '--room', 'zj4jlety9q',
      '--message', '/loop progress toward /goal 100%',
      '--start',
      '--created-by', '@evolveantcodex'
    ], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/cron-jobs');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(JSON.parse(captured.requests[0].init.body)).toMatchObject({
      name: 'Goal loop',
      intervalMs: 600_000,
      action: 'room.message',
      targetRoomId: 'zj4jlety9q',
      targetMessageTemplate: '/loop progress toward /goal 100%',
      startImmediately: true,
      createdByHandle: '@evolveantcodex'
    });
    expect(captured.stdout[0]).toContain('cron_123');
    expect(captured.stdout[0]).toContain('running');
  });

  it('lists active cron jobs and can include deleted rows', async () => {
    const { runtime, captured } = makeRuntime(() => makeJsonResponse({ jobs: [SAMPLE_JOB] }));

    await handlePlanVerb('cron', ['list'], runtime, { CliInputError });
    await handlePlanVerb('cron', ['list', '--include-deleted', '--json'], runtime, { CliInputError });

    expect(captured.requests[0].url).toBe('http://test.local/api/cron-jobs');
    expect(captured.requests[1].url).toBe('http://test.local/api/cron-jobs?includeDeleted=true');
    expect(captured.stdout[0]).toContain('Goal loop');
    expect(JSON.parse(captured.stdout[1]).jobs[0].id).toBe('cron_123');
  });

  it('shows a cron job by id', async () => {
    const { runtime, captured } = makeRuntime(() => makeJsonResponse({ job: SAMPLE_JOB }));

    await handlePlanVerb('cron', ['show', 'cron_123'], runtime, { CliInputError });

    expect(captured.requests[0].url).toBe('http://test.local/api/cron-jobs/cron_123');
    expect(captured.stdout[0]).toContain('Goal loop');
    expect(captured.stdout[0]).toContain('10m');
  });

  it('sends lifecycle actions for start, pause, stop, and delete', async () => {
    const actions = [];
    const { runtime, captured } = makeRuntime((_url, init) => {
      actions.push(JSON.parse(init.body).action);
      return makeJsonResponse({ job: { ...SAMPLE_JOB, status: actions.at(-1) === 'delete' ? 'deleted' : 'paused' } });
    });

    await handlePlanVerb('cron', ['start', 'cron_123'], runtime, { CliInputError });
    await handlePlanVerb('cron', ['pause', 'cron_123'], runtime, { CliInputError });
    await handlePlanVerb('cron', ['stop', 'cron_123'], runtime, { CliInputError });
    await handlePlanVerb('cron', ['delete', 'cron_123'], runtime, { CliInputError });

    expect(actions).toEqual(['start', 'pause', 'stop', 'delete']);
    expect(captured.requests.every((r) => r.url === 'http://test.local/api/cron-jobs/cron_123')).toBe(true);
    expect(captured.requests.every((r) => r.init.method === 'PATCH')).toBe(true);
    expect(captured.stdout.at(-1)).toContain('deleted');
  });

  it('rejects create without a name', async () => {
    const { runtime } = makeRuntime(() => makeJsonResponse({}));
    await expect(
      handlePlanVerb('cron', ['create', '--every-minutes', '10'], runtime, { CliInputError })
    ).rejects.toThrow(CliInputError);
  });
});
