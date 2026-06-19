import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import {
  findAnnotationByKeys,
  getScreenState,
  listAuditForElement,
  upsertAnnotation,
  upsertScreenState
} from '$lib/server/manualScreenStore';
import { GET as listStates } from './+server';
import { POST as createState } from './[screenId]/+server';
import { GET as getState, PATCH as patchState, DELETE as deleteState } from './[screenId]/[stateSlug]/+server';
import { POST as createAnnotation } from './[screenId]/[stateSlug]/annotations/+server';
import {
  PATCH as patchAnnotation,
  DELETE as deleteAnnotation
} from './[screenId]/[stateSlug]/annotations/[elementSlug]/+server';
import { GET as getAnnotationAudit } from './[screenId]/[stateSlug]/annotations/[elementSlug]/audit/+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'manual-states-admin-token';

type AnyHandler = (event: unknown) => unknown;

function authHeaders(authenticated = true): Record<string, string> {
  return authenticated ? { authorization: `Bearer ${ADMIN_TOKEN}` } : {};
}

function jsonHeaders(authenticated = true): Record<string, string> {
  return { 'content-type': 'application/json', ...authHeaders(authenticated) };
}

function eventFor(path: string, opts: {
  method?: string;
  body?: unknown;
  authenticated?: boolean;
  params?: Record<string, string>;
  search?: string;
} = {}) {
  const url = new URL(`http://localhost${path}${opts.search ?? ''}`);
  const authenticated = opts.authenticated ?? true;
  const request = new Request(url, {
    method: opts.method ?? 'GET',
    headers: opts.body === undefined ? authHeaders(authenticated) : jsonHeaders(authenticated),
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body)
  });
  return { request, url, params: opts.params ?? {} };
}

function stateParams(extra: Record<string, string> = {}) {
  return { screenId: 'screen-a', stateSlug: 'base', ...extra };
}

function seedState() {
  return upsertScreenState({
    screenId: 'screen-a',
    stateSlug: 'base',
    stateLabel: 'Base',
    screenshotPath: '/api/assets/manual/base.png',
    viewportW: 1200,
    viewportH: 800
  });
}

function seedAnnotation() {
  seedState();
  return upsertAnnotation({
    screenId: 'screen-a',
    stateSlug: 'base',
    elementSlug: 'button-a',
    itemName: 'Button A',
    bbox: { x: 10, y: 20, w: 30, h: 40 }
  });
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

describe('manual state auth gates', () => {
  it('requires authenticated aggregate-read access for the state catalogue', async () => {
    seedState();

    expect((await run(listStates as unknown as AnyHandler, eventFor('/api/manual/states', { authenticated: false }))).status)
      .toBe(401);

    const response = await run(listStates as unknown as AnyHandler, eventFor('/api/manual/states'));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.states).toHaveLength(1);
  });

  it('rejects anonymous state creation before inserting a row', async () => {
    const response = await run(
      createState as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a', {
        method: 'POST',
        body: { stateLabel: 'Created' },
        authenticated: false,
        params: { screenId: 'screen-a' }
      })
    );

    expect(response.status).toBe(401);
    expect(getScreenState('screen-a', 'created')).toBeNull();
  });

  it('requires authenticated aggregate-read access for a state detail', async () => {
    seedState();

    const anonymous = await run(
      getState as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base', { authenticated: false, params: stateParams() })
    );
    expect(anonymous.status).toBe(401);

    const authenticated = await run(
      getState as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base', { params: stateParams() })
    );
    expect(authenticated.status).toBe(200);
  });

  it('rejects anonymous state updates and deletes before mutating the row', async () => {
    seedState();

    const patch = await run(
      patchState as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base', {
        method: 'PATCH',
        body: { stateLabel: 'Changed' },
        authenticated: false,
        params: stateParams()
      })
    );
    expect(patch.status).toBe(401);
    expect(getScreenState('screen-a', 'base')?.state_label).toBe('Base');

    const deleted = await run(
      deleteState as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base', {
        method: 'DELETE',
        authenticated: false,
        params: stateParams()
      })
    );
    expect(deleted.status).toBe(401);
    expect(getScreenState('screen-a', 'base')).not.toBeNull();
  });

  it('rejects anonymous annotation creation before inserting a row', async () => {
    seedState();

    const response = await run(
      createAnnotation as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base/annotations', {
        method: 'POST',
        body: {
          elementSlug: 'button-a',
          itemName: 'Button A',
          bbox: { x: 10, y: 20, w: 30, h: 40 }
        },
        authenticated: false,
        params: stateParams()
      })
    );

    expect(response.status).toBe(401);
    expect(findAnnotationByKeys('screen-a', 'base', 'button-a')).toBeNull();
  });

  it('rejects anonymous annotation updates and deletes before mutating the row', async () => {
    seedAnnotation();

    const patch = await run(
      patchAnnotation as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base/annotations/button-a', {
        method: 'PATCH',
        body: { itemName: 'Changed button' },
        authenticated: false,
        params: stateParams({ elementSlug: 'button-a' })
      })
    );
    expect(patch.status).toBe(401);
    expect(findAnnotationByKeys('screen-a', 'base', 'button-a')?.item_name).toBe('Button A');

    const deleted = await run(
      deleteAnnotation as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base/annotations/button-a', {
        method: 'DELETE',
        authenticated: false,
        params: stateParams({ elementSlug: 'button-a' })
      })
    );
    expect(deleted.status).toBe(401);
    expect(findAnnotationByKeys('screen-a', 'base', 'button-a')).not.toBeNull();
  });

  it('requires authenticated aggregate-read access for annotation audit history', async () => {
    seedAnnotation();
    expect(listAuditForElement('screen-a', 'base', 'button-a')).toEqual([]);

    const anonymous = await run(
      getAnnotationAudit as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base/annotations/button-a/audit', {
        authenticated: false,
        params: stateParams({ elementSlug: 'button-a' })
      })
    );
    expect(anonymous.status).toBe(401);

    const authenticated = await run(
      getAnnotationAudit as unknown as AnyHandler,
      eventFor('/api/manual/states/screen-a/base/annotations/button-a/audit', {
        params: stateParams({ elementSlug: 'button-a' })
      })
    );
    expect(authenticated.status).toBe(200);
    expect((await authenticated.json()).audit).toEqual([]);
  });
});
