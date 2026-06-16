import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POST } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { getOperatorEmail } from '$lib/server/operatorEmail';

const TEST_ADMIN = 'owner-register-admin-token';
let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousAdminToken = process.env.ANT_ADMIN_TOKEN;
const previousOperatorEmail = process.env.ANT_OPERATOR_EMAIL;
const previousDemoEmail = process.env.ANT_DEMO_EMAIL;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-owner-register-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN;
  delete process.env.ANT_OPERATOR_EMAIL;
  delete process.env.ANT_DEMO_EMAIL;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  restoreEnv('ANT_FRESH_DB_PATH', previousDbPath);
  restoreEnv('ANT_ADMIN_TOKEN', previousAdminToken);
  restoreEnv('ANT_OPERATOR_EMAIL', previousOperatorEmail);
  restoreEnv('ANT_DEMO_EMAIL', previousDemoEmail);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

function eventForPost(body: unknown, opts: { admin?: boolean } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (opts.admin !== false) headers.authorization = `Bearer ${TEST_ADMIN}`;
  return {
    request: new Request('http://localhost/api/owners/register', {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    }),
    params: {},
    url: new URL('http://localhost/api/owners/register')
  } as never;
}

async function capture(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('POST /api/owners/register', () => {
  it('sets the operator account email during trusted owner bootstrap', async () => {
    const response = await capture(() =>
      POST(eventForPost({
        handle: '@JWPK',
        password: 'correct-horse',
        operatorEmail: ' Operator@Example.COM '
      }))
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ operatorEmailConfigured: true });
    expect(getOperatorEmail()).toBe('operator@example.com');
  });

  it('does not let an unauthenticated request set operator account email', async () => {
    const response = await capture(() =>
      POST(eventForPost({
        handle: '@JWPK',
        password: 'correct-horse',
        operatorEmail: 'operator@example.com'
      }, { admin: false }))
    );

    expect(response.status).toBe(401);
    expect(getOperatorEmail()).toBeNull();
  });

  it('rejects an invalid operator account email before creating the owner', async () => {
    const response = await capture(() =>
      POST(eventForPost({
        handle: '@JWPK',
        password: 'correct-horse',
        operatorEmail: 'not an email'
      }))
    );

    expect(response.status).toBe(400);
    expect(getOperatorEmail()).toBeNull();
  });
});
