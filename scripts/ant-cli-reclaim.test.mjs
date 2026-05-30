/**
 * ant reclaim CLI tests — PR-C super-admin reclaim CLI primitive
 * (substrate v0.2 plan, 2026-05-29).
 *
 * Stubs fetch and asserts URL/body/headers shape for each verb plus
 * input validation and error surfacing.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleReclaimVerb } from './ant-cli-reclaim.mjs';

class CliInputError extends Error {}

const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = 'test-admin-token';
});

afterEach(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

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

const okJson = (body, status = 200) => ({
  ok: true,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

const failJson = (body, status) => ({
  ok: false,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

describe('ant reclaim CLI — file verb', () => {
  it('posts to /api/reclaim-requests with the bearer + body shape', async () => {
    const reclaim = {
      reclaimId: 'rcl_abc',
      status: 'pending',
      targetKind: 'terminal',
      targetId: 't_x'
    };
    const { runtime, captured } = makeRuntime(() =>
      okJson({ request: reclaim }, 201)
    );
    const code = await handleReclaimVerb(
      'file',
      [
        '--target-kind',
        'terminal',
        '--target-id',
        't_x',
        '--reason',
        'stale'
      ],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/reclaim-requests');
    expect(captured.requests[0].init.method).toBe('POST');
    expect(captured.requests[0].init.headers.authorization).toBe(
      'Bearer test-admin-token'
    );
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.targetKind).toBe('terminal');
    expect(body.targetId).toBe('t_x');
    expect(body.reason).toBe('stale');
    expect(body.diagnostic).toBeUndefined();
    expect(captured.stdout[0]).toContain('rcl_abc');
  });

  it('--admin-token overrides ANT_ADMIN_TOKEN env', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ request: { reclaimId: 'rcl_x' } }, 201)
    );
    await handleReclaimVerb(
      'file',
      [
        '--target-kind',
        'terminal',
        '--target-id',
        't_x',
        '--reason',
        'x',
        '--admin-token',
        'override-tok'
      ],
      runtime,
      { CliInputError }
    );
    expect(captured.requests[0].init.headers.authorization).toBe(
      'Bearer override-tok'
    );
  });

  it('reads --diagnostic-file and folds JSON into the request body', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'rcl-diag-'));
    const diagPath = join(dir, 'diag.json');
    writeFileSync(diagPath, JSON.stringify({ rowsObserved: 2 }));
    try {
      const { runtime, captured } = makeRuntime(() =>
        okJson({ request: { reclaimId: 'rcl_d' } }, 201)
      );
      await handleReclaimVerb(
        'file',
        [
          '--target-kind',
          'membership',
          '--target-id',
          'm_x',
          '--reason',
          'dual',
          '--diagnostic-file',
          diagPath
        ],
        runtime,
        { CliInputError }
      );
      const body = JSON.parse(captured.requests[0].init.body);
      expect(body.diagnostic).toEqual({ rowsObserved: 2 });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('rejects missing --target-kind', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb(
        'file',
        ['--target-id', 't_x', '--reason', 'x'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--target-kind/);
  });

  it('rejects unknown --target-kind value', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb(
        'file',
        [
          '--target-kind',
          'galaxy',
          '--target-id',
          't_x',
          '--reason',
          'x'
        ],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--target-kind must be one of/);
  });

  it('rejects missing --reason', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb(
        'file',
        ['--target-kind', 'terminal', '--target-id', 't_x'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--reason/);
  });

  it('rejects when no admin token resolvable', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb(
        'file',
        [
          '--target-kind',
          'terminal',
          '--target-id',
          't_x',
          '--reason',
          'x'
        ],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/admin token required/);
  });

  it('surfaces server errors with status code', async () => {
    const { runtime } = makeRuntime(() =>
      failJson({ message: 'forbidden' }, 403)
    );
    await expect(
      handleReclaimVerb(
        'file',
        [
          '--target-kind',
          'terminal',
          '--target-id',
          't_x',
          '--reason',
          'x'
        ],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/403/);
  });
});

describe('ant reclaim CLI — list verb', () => {
  it('GETs /api/reclaim-requests with bearer + prints pending rows', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({
        requests: [
          {
            reclaimId: 'rcl_a',
            status: 'pending',
            targetKind: 'terminal',
            targetId: 't_a',
            reason: 'r1'
          },
          {
            reclaimId: 'rcl_b',
            status: 'pending',
            targetKind: 'membership',
            targetId: 'm_b',
            reason: 'r2'
          }
        ]
      })
    );
    const code = await handleReclaimVerb('list', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/reclaim-requests');
    expect(captured.requests[0].init.headers.authorization).toBe(
      'Bearer test-admin-token'
    );
    expect(captured.stdout).toHaveLength(2);
    expect(captured.stdout[0]).toContain('rcl_a');
    expect(captured.stdout[1]).toContain('rcl_b');
  });

  it('prints empty-list banner when no pending requests', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ requests: [] }));
    await handleReclaimVerb('list', [], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('no pending reclaim requests');
  });
});

describe('ant reclaim CLI — show verb', () => {
  it('GETs /api/reclaim-requests/:id and pretty-prints the row', async () => {
    const row = { reclaimId: 'rcl_x', status: 'pending', targetKind: 'terminal' };
    const { runtime, captured } = makeRuntime(() => okJson({ request: row }));
    await handleReclaimVerb('show', ['rcl_x'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/reclaim-requests/rcl_x');
    expect(captured.stdout[0]).toContain('"reclaimId": "rcl_x"');
  });

  it('rejects missing reclaim id', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb('show', [], runtime, { CliInputError })
    ).rejects.toThrow(/reclaim_id/);
  });
});

describe('ant reclaim CLI — execute verb', () => {
  it('POSTs /api/reclaim-requests/:id/execute and prints actions', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({
        request: { reclaimId: 'rcl_e', status: 'executed' },
        actions: [
          { kind: 'terminal_archived', detail: 'archived t_x', rowsAffected: 1, dryRun: false }
        ]
      })
    );
    const code = await handleReclaimVerb('execute', ['rcl_e'], runtime, {
      CliInputError
    });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe(
      'http://test.local/api/reclaim-requests/rcl_e/execute'
    );
    expect(captured.requests[0].init.method).toBe('POST');
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.dryRun).toBeUndefined();
    expect(captured.stdout[0]).toContain('executed');
    expect(captured.stdout[1]).toContain('terminal_archived');
  });

  it('--dry-run sets body.dryRun=true and banner says dry-run', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({
        request: { reclaimId: 'rcl_e', status: 'pending' },
        actions: [
          { kind: 'terminal_archived', detail: 'would archive', rowsAffected: 1, dryRun: true }
        ]
      })
    );
    await handleReclaimVerb('execute', ['rcl_e', '--dry-run'], runtime, {
      CliInputError
    });
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.dryRun).toBe(true);
    expect(captured.stdout[0]).toContain('dry-run');
  });

  it('rejects missing reclaim id', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb('execute', [], runtime, { CliInputError })
    ).rejects.toThrow(/reclaim_id/);
  });

  it('surfaces 409 already-executed errors', async () => {
    const { runtime } = makeRuntime(() =>
      failJson({ message: 'already executed' }, 409)
    );
    await expect(
      handleReclaimVerb('execute', ['rcl_e'], runtime, { CliInputError })
    ).rejects.toThrow(/409/);
  });
});

describe('ant reclaim CLI — deny verb', () => {
  it('POSTs /api/reclaim-requests/:id/deny with the reason', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ request: { reclaimId: 'rcl_d', status: 'denied' } })
    );
    await handleReclaimVerb('deny', ['rcl_d', '--reason', 'not safe'], runtime, {
      CliInputError
    });
    expect(captured.requests[0].url).toBe(
      'http://test.local/api/reclaim-requests/rcl_d/deny'
    );
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.reason).toBe('not safe');
    expect(captured.stdout[0]).toContain('denied');
  });

  it('rejects missing --reason', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb('deny', ['rcl_d'], runtime, { CliInputError })
    ).rejects.toThrow(/--reason/);
  });

  it('rejects missing reclaim id', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb('deny', ['--reason', 'no'], runtime, { CliInputError })
    ).rejects.toThrow(/reclaim_id/);
  });
});

describe('ant reclaim CLI — dispatch + help', () => {
  it('prints usage when no action supplied (exit 1)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    const code = await handleReclaimVerb(undefined, [], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stdout.join('\n')).toContain('ant reclaim');
  });

  it('prints usage on explicit help (exit 0)', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    const code = await handleReclaimVerb('help', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout.join('\n')).toContain('ant reclaim');
  });

  it('rejects unknown verb with usage banner', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleReclaimVerb('shenanigans', [], runtime, { CliInputError })
    ).rejects.toThrow(/unknown reclaim verb/);
    expect(captured.stdout.join('\n')).toContain('ant reclaim');
  });
});
