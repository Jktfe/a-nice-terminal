import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET, POST } from './+server';
import { resetPlanModeStoreForTests, type PlanEvent } from '$lib/server/planModeStore';

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const TEST_ADMIN_TOKEN = 'plan-mode-route-test-admin';

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetPlanModeStoreForTests();
});

afterEach(() => {
  resetPlanModeStoreForTests();
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

type HandlerEvent = Parameters<typeof GET>[0];

function makeGetEvent(planId: string, authenticated = true): HandlerEvent {
  const headers = authenticated ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return {
    params: { planId },
    request: new Request(`http://test.local/api/plan/${planId}`, { headers })
  } as unknown as HandlerEvent;
}

function makePostEvent(planId: string, bodyValue: unknown, authenticated = true): HandlerEvent {
  const bodyText = typeof bodyValue === 'string' ? bodyValue : JSON.stringify(bodyValue);
  const headers = authenticated ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  return {
    params: { planId },
    request: new Request(`http://test.local/api/plan/${planId}`, {
      method: 'POST',
      headers,
      body: bodyText
    })
  } as unknown as HandlerEvent;
}

function validEventBody(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'evt-1',
    plan_id: 'plan-a',
    kind: 'plan_section',
    title: 'Foundation',
    order: 1,
    author_handle: '@claude2',
    author_kind: 'agent',
    ...overrides
  };
}

async function expectRejectedWith(promise: unknown, expectedStatus: number) {
  let captured: unknown = null;
  try {
    await promise;
  } catch (failure) {
    captured = failure;
  }
  expect(captured).toBeTruthy();
  expect((captured as { status?: number }).status).toBe(expectedStatus);
}

describe('plan endpoint', () => {
  it('auth: rejects anonymous GET and POST', async () => {
    await expectRejectedWith(GET(makeGetEvent('plan-a', false)), 401);
    await expectRejectedWith(POST(makePostEvent('plan-a', validEventBody(), false)), 401);
  });

  it('E1: GET returns 200 + empty events for unknown plan_id', async () => {
    const response = await GET(makeGetEvent('unknown-plan'));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { events: PlanEvent[] };
    expect(body.events).toEqual([]);
  });

  it('E2: POST then GET roundtrip — appended event appears in projection', async () => {
    const postResponse = await POST(makePostEvent('plan-a', validEventBody()));
    expect(postResponse.status).toBe(200);
    const postBody = (await postResponse.json()) as { event: PlanEvent };
    expect(postBody.event.title).toBe('Foundation');
    expect(postBody.event.ts_millis).toBeGreaterThan(0);

    const getResponse = await GET(makeGetEvent('plan-a'));
    const getBody = (await getResponse.json()) as { events: PlanEvent[] };
    expect(getBody.events).toHaveLength(1);
    expect(getBody.events[0].id).toBe('evt-1');
  });

  it('E3: POST fails 400 on malformed JSON / empty body / array body / null body', async () => {
    await expectRejectedWith(POST(makePostEvent('plan-a', 'not-json{')), 400);
    await expectRejectedWith(POST(makePostEvent('plan-a', '')), 400);
    await expectRejectedWith(POST(makePostEvent('plan-a', [])), 400);
    await expectRejectedWith(POST(makePostEvent('plan-a', null)), 400);
  });

  it('E4: POST fails 400 on missing required fields (including plan_id)', async () => {
    const requiredFields = ['id', 'plan_id', 'kind', 'title', 'order', 'author_handle', 'author_kind'];
    for (const field of requiredFields) {
      const body = validEventBody();
      delete body[field];
      await expectRejectedWith(POST(makePostEvent('plan-a', body)), 400);
    }
  });

  it('E4b: POST fails 400 when plan_id is present but non-string', async () => {
    await expectRejectedWith(POST(makePostEvent('plan-a', validEventBody({ plan_id: 42 }))), 400);
  });

  it('E5: POST fails 400 on bad kind enum', async () => {
    await expectRejectedWith(POST(makePostEvent('plan-a', validEventBody({ kind: 'plan_unknown' }))), 400);
  });

  it('E6: POST fails 400 on bad status enum', async () => {
    await expectRejectedWith(POST(makePostEvent('plan-a', validEventBody({ status: 'sideways' }))), 400);
  });

  it('E7: POST fails 400 on plan_id mismatch URL vs body', async () => {
    await expectRejectedWith(POST(makePostEvent('plan-a', validEventBody({ plan_id: 'plan-b' }))), 400);
  });

  it('E8: POST injects monotonic ts_millis — rapid appends never tie', async () => {
    const tsValues = new Set<number>();
    for (let runIndex = 0; runIndex < 10; runIndex++) {
      const response = await POST(
        makePostEvent('plan-a', validEventBody({ id: `evt-${runIndex}`, title: `Section ${runIndex}` }))
      );
      const body = (await response.json()) as { event: PlanEvent };
      tsValues.add(body.event.ts_millis);
    }
    expect(tsValues.size).toBe(10);
  });

  it('E9: POST returns 200 { event } shape with the appended event', async () => {
    const response = await POST(makePostEvent('plan-a', validEventBody({ id: 'evt-shape' })));
    const body = (await response.json()) as { event: PlanEvent };
    expect(body.event.id).toBe('evt-shape');
    expect(body.event.plan_id).toBe('plan-a');
    expect(body.event.kind).toBe('plan_section');
    expect(body.event.author_kind).toBe('agent');
    expect(body.event.evidence).toEqual([]);
  });

  it('extra: POST fails 400 on author_kind not in agent|human|system', async () => {
    await expectRejectedWith(POST(makePostEvent('plan-a', validEventBody({ author_kind: 'robot' }))), 400);
  });
});
