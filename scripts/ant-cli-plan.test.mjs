import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handlePlanVerb } from './ant-cli-plan.mjs';

class CliInputError extends Error {}

function makeRuntime() {
  const captured = { posts: [], requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    if (!init.body) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ plans: [{ id: 'plan-a', title: 'Plan A', archived_at_ms: null }] }),
        text: async () => 'ok'
      };
    }
    const body = JSON.parse(init.body);
    captured.posts.push({ url, body, init });
    return {
      ok: true,
      status: 200,
      json: async () => (
        body.action
          ? { plan: { id: url.split('/').pop(), archivedAtMs: body.action === 'archive' ? 1_000 : null } }
          : { event: { ...body, ts_millis: 1_000, evidence: [] } }
      ),
      text: async () => 'ok'
    };
  };
  const runtime = {
    fetchImpl,
    serverUrl: 'http://test.local',
    writeOut: (line) => captured.stdout.push(line),
    writeErr: (line) => captured.stderr.push(line)
  };
  return { runtime, captured };
}

function makeFailingRuntime(status, errorBody) {
  const captured = { stdout: [], stderr: [] };
  const fetchImpl = async () => ({
    ok: false,
    status,
    json: async () => ({}),
    text: async () => errorBody
  });
  const runtime = {
    fetchImpl,
    serverUrl: 'http://test.local',
    writeOut: (line) => captured.stdout.push(line),
    writeErr: (line) => captured.stderr.push(line)
  };
  return { runtime, captured };
}

beforeEach(() => {
  delete process.env.ANT_AUTHOR;
});

afterEach(() => {
  delete process.env.ANT_AUTHOR;
});

describe('ant plan CLI write verbs', () => {
  it('C1: section POSTs kind=plan_section with title', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('section', ['plan-a', '--title', 'Foundation', '--order', '2'], runtime, { CliInputError });
    expect(captured.posts).toHaveLength(1);
    const sent = captured.posts[0].body;
    expect(sent.kind).toBe('plan_section');
    expect(sent.title).toBe('Foundation');
    expect(sent.plan_id).toBe('plan-a');
    expect(sent.order).toBe(2);
    expect(sent.author_kind).toBe('agent');
  });

  it('C2: milestone POSTs kind=plan_milestone with milestone_id + status', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('milestone', ['plan-a', '--id', 'pm-store', '--title', 'Foundation store', '--owner', '@claude2', '--status', 'passing'], runtime, { CliInputError });
    const sent = captured.posts[0].body;
    expect(sent.kind).toBe('plan_milestone');
    expect(sent.milestone_id).toBe('pm-store');
    expect(sent.owner).toBe('@claude2');
    expect(sent.status).toBe('passing');
  });

  it('C3: acceptance POSTs kind=plan_acceptance with milestone + acceptance_id', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('acceptance', ['plan-a', '--milestone', 'pm-store', '--id', 'a-build-done', '--title', 'Build done'], runtime, { CliInputError });
    const sent = captured.posts[0].body;
    expect(sent.kind).toBe('plan_acceptance');
    expect(sent.milestone_id).toBe('pm-store');
    expect(sent.acceptance_id).toBe('a-build-done');
  });

  it('C4: test POSTs kind=plan_test with milestone + title + status', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('test', ['plan-a', '--milestone', 'pm-store', '--title', 'Tests pass', '--status', 'passing'], runtime, { CliInputError });
    const sent = captured.posts[0].body;
    expect(sent.kind).toBe('plan_test');
    expect(sent.milestone_id).toBe('pm-store');
    expect(sent.title).toBe('Tests pass');
    expect(sent.status).toBe('passing');
  });

  it('C5: decision POSTs kind=plan_decision with parent_id', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('decision', ['plan-a', '--parent', 'sec-foundation', '--title', 'Use module-level Map'], runtime, { CliInputError });
    const sent = captured.posts[0].body;
    expect(sent.kind).toBe('plan_decision');
    expect(sent.parent_id).toBe('sec-foundation');
  });

  it('C6a: milestone-status re-emits plan_milestone with same milestone_id + new status', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('milestone-status', ['plan-a', '--id', 'pm-store', '--status', 'done'], runtime, { CliInputError });
    const sent = captured.posts[0].body;
    expect(sent.kind).toBe('plan_milestone');
    expect(sent.milestone_id).toBe('pm-store');
    expect(sent.status).toBe('done');
  });

  it('C6b: test-status re-emits plan_test with same milestone+title + new status', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('test-status', ['plan-a', '--milestone', 'pm-store', '--title', 'Tests pass', '--status', 'failing'], runtime, { CliInputError });
    const sent = captured.posts[0].body;
    expect(sent.kind).toBe('plan_test');
    expect(sent.milestone_id).toBe('pm-store');
    expect(sent.title).toBe('Tests pass');
    expect(sent.status).toBe('failing');
  });

  it('C7a: milestone-archive emits status=archived', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('milestone-archive', ['plan-a', '--id', 'pm-store'], runtime, { CliInputError });
    expect(captured.posts[0].body.status).toBe('archived');
    expect(captured.posts[0].body.kind).toBe('plan_milestone');
  });

  it('C7b: test-archive emits status=archived', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('test-archive', ['plan-a', '--milestone', 'pm-store', '--title', 'Tests pass'], runtime, { CliInputError });
    expect(captured.posts[0].body.status).toBe('archived');
    expect(captured.posts[0].body.kind).toBe('plan_test');
  });

  it('C7c: decision-archive emits status=archived', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('decision-archive', ['plan-a', '--parent', 'sec-foundation', '--title', 'Use Map'], runtime, { CliInputError });
    expect(captured.posts[0].body.status).toBe('archived');
    expect(captured.posts[0].body.kind).toBe('plan_decision');
  });

  it('C8: missing required flag throws CliInputError', async () => {
    const { runtime } = makeRuntime();
    let captured = null;
    try {
      await handlePlanVerb('milestone', ['plan-a', '--title', 'X'], runtime, { CliInputError });
    } catch (failure) {
      captured = failure;
    }
    expect(captured).toBeInstanceOf(CliInputError);
  });

  it('C9: server 400 response surfaces as a thrown Error', async () => {
    const { runtime } = makeFailingRuntime(400, 'Body must be a JSON object.');
    let captured = null;
    try {
      await handlePlanVerb('section', ['plan-a', '--title', 'Foundation'], runtime, { CliInputError });
    } catch (failure) {
      captured = failure;
    }
    expect(captured).toBeTruthy();
    expect(captured.message).toContain('400');
  });

  it('extra: ANT_AUTHOR env overrides default author_handle', async () => {
    process.env.ANT_AUTHOR = '@jwpk';
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('section', ['plan-a', '--title', 'X'], runtime, { CliInputError });
    expect(captured.posts[0].body.author_handle).toBe('@jwpk');
  });

  it('C10: list GETs plans and supports --json', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('list', [], runtime, { CliInputError });
    await handlePlanVerb('list', ['--include-archived', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/plans');
    expect(captured.requests[1].url).toBe('http://test.local/api/plans?include-archived=1');
    expect(captured.stdout[0]).toContain('plan-a');
    expect(JSON.parse(captured.stdout[1]).plans[0].id).toBe('plan-a');
  });

  it('C11: archive PATCHes plan lifecycle and parses --unarchive as boolean', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('archive', ['plan-a'], runtime, { CliInputError });
    await handlePlanVerb('archive', ['plan-a', '--unarchive', '--json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/plans/plan-a');
    expect(captured.requests[0].init.method).toBe('PATCH');
    expect(captured.posts[0].body).toMatchObject({ action: 'archive' });
    expect(captured.posts[1].body).toMatchObject({ action: 'unarchive' });
    expect(JSON.parse(captured.stdout[1]).plan.archivedAtMs).toBeNull();
  });

  it('C12: attach-room POSTs a plan-room link through the ANT plan CLI', async () => {
    const { runtime, captured } = makeRuntime();
    await handlePlanVerb('attach-room', ['plan-a', 'room-1', '--attached-by', '@codex'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/plans/plan-a/rooms');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(captured.posts[0].body).toEqual({ roomId: 'room-1', attachedBy: '@codex' });
  });

  it('C13: attach-room requires a room id', async () => {
    const { runtime } = makeRuntime();
    let captured = null;
    try {
      await handlePlanVerb('attach-room', ['plan-a'], runtime, { CliInputError });
    } catch (failure) {
      captured = failure;
    }
    expect(captured).toBeInstanceOf(CliInputError);
  });
});
