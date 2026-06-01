/**
 * Tests for ant-cli-tools — PR-D tools catalog CLI verbs.
 *
 * Covers: register / deprecate / retire / list / grant / revoke / and
 * the import-skills dry-run + commit paths (the latter exercises the
 * SKILL.md frontmatter parser).
 */

import { describe, expect, it } from 'vitest';
import { handleToolsVerb, _internals } from './ant-cli-tools.mjs';
import { makeCliRunner } from './ant-cli.mjs';

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
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function notOk(status, message) {
  return {
    ok: false,
    status,
    json: async () => ({ message }),
    text: async () => message
  };
}

describe('ant tools register', () => {
  it('POSTs to /api/tools with the parsed flags', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ tool: { toolId: 'tool_abc', toolSlug: 'graphify' } }, 201)
    );
    const code = await handleToolsVerb(
      'register',
      ['--slug', 'graphify', '--kind', 'skill', '--name', 'Graphify', '--version', '0.3.1'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/tools');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.toolSlug).toBe('graphify');
    expect(body.kind).toBe('skill');
    expect(body.name).toBe('Graphify');
    expect(body.version).toBe('0.3.1');
    expect(captured.stdout.join('\n')).toContain('tool_abc');
  });

  it('threads admin-bearer from --admin-token flag', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tool: { toolId: 't' } }, 201));
    await handleToolsVerb(
      'register',
      ['--slug', 'x', '--kind', 'skill', '--name', 'X', '--admin-token', 'tok123'],
      runtime,
      { CliInputError }
    );
    expect(captured.requests[0].init.headers.authorization).toBe('Bearer tok123');
  });

  it('rejects invalid --kind', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleToolsVerb(
        'register',
        ['--slug', 'x', '--kind', 'mystery', '--name', 'X'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--kind/);
  });

  it('rejects invalid --min-tier', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleToolsVerb(
        'register',
        ['--slug', 'x', '--kind', 'skill', '--name', 'X', '--min-tier', 'gold'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--min-tier/);
  });

  it('rejects invalid --metadata JSON', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleToolsVerb(
        'register',
        ['--slug', 'x', '--kind', 'skill', '--name', 'X', '--metadata', 'not-json'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/JSON/);
  });

  it('surfaces server error status and returns 1', async () => {
    const { runtime, captured } = makeRuntime(() => notOk(401, 'admin auth required'));
    const code = await handleToolsVerb(
      'register',
      ['--slug', 'x', '--kind', 'skill', '--name', 'X'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('401');
  });
});

describe('ant tools list', () => {
  it('GETs /api/tools and renders one row per tool', async () => {
    const tools = [
      {
        toolSlug: 'a',
        kind: 'skill',
        version: '1.0',
        ownerOrg: 'org1',
        minTier: 'oss',
        retiredAtMs: null,
        deprecatedAtMs: null
      },
      {
        toolSlug: 'b',
        kind: 'mcp',
        version: null,
        ownerOrg: null,
        minTier: 'oss',
        retiredAtMs: null,
        deprecatedAtMs: 1
      }
    ];
    const { runtime, captured } = makeRuntime(() => okJson({ tools }));
    const code = await handleToolsVerb('list', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/tools');
    expect(captured.stdout[0]).toContain('a');
    expect(captured.stdout[1]).toContain('deprecated');
  });

  it('forwards --kind and --owner-org as query params', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tools: [] }));
    await handleToolsVerb('list', ['--kind', 'mcp', '--owner-org', 'orgA'], runtime, {
      CliInputError
    });
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('kind')).toBe('mcp');
    expect(u.searchParams.get('owner_org')).toBe('orgA');
  });

  it('forwards --include-retired as includeRetired=1', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tools: [] }));
    await handleToolsVerb('list', ['--include-retired'], runtime, { CliInputError });
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('includeRetired')).toBe('1');
  });

  it('--json passes payload through unchanged', async () => {
    const tools = [{ toolSlug: 'x', kind: 'skill' }];
    const { runtime, captured } = makeRuntime(() => okJson({ tools }));
    await handleToolsVerb('list', ['--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(tools);
  });
});

describe('ant tools deprecate + retire', () => {
  it('deprecate looks up the slug then POSTs /api/tools/:id/deprecate', async () => {
    const { runtime, captured } = makeRuntime((n, req) => {
      if (n === 1) {
        return okJson({
          tools: [{ toolId: 'tool_X', toolSlug: 'graphify', retiredAtMs: null }]
        });
      }
      return okJson({ tool: { toolId: 'tool_X', deprecatedAtMs: 1 } });
    });
    const code = await handleToolsVerb('deprecate', ['--slug', 'graphify'], runtime, {
      CliInputError
    });
    expect(code).toBe(0);
    expect(captured.requests[1].url).toBe('http://test.local/api/tools/tool_X/deprecate');
    expect(captured.requests[1].init.method).toBe('POST');
  });

  it('deprecate prints an error when slug not found', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tools: [] }));
    const code = await handleToolsVerb('deprecate', ['--slug', 'gone'], runtime, {
      CliInputError
    });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('no tool with slug');
  });

  it('retire looks up the slug then DELETEs /api/tools/:id', async () => {
    const { runtime, captured } = makeRuntime((n) => {
      if (n === 1) {
        return okJson({
          tools: [{ toolId: 'tool_R', toolSlug: 'nifty', retiredAtMs: null }]
        });
      }
      return okJson({ tool: { toolId: 'tool_R', retiredAtMs: 999 } });
    });
    const code = await handleToolsVerb('retire', ['--slug', 'nifty'], runtime, {
      CliInputError
    });
    expect(code).toBe(0);
    expect(captured.requests[1].url).toBe('http://test.local/api/tools/tool_R');
    expect(captured.requests[1].init.method).toBe('DELETE');
  });
});

describe('ant tools grant + revoke', () => {
  it('grant looks up the slug then POSTs /api/tool-grants', async () => {
    const { runtime, captured } = makeRuntime((n) => {
      if (n === 1) {
        return okJson({
          tools: [{ toolId: 'tool_G', toolSlug: 'graphify', retiredAtMs: null }]
        });
      }
      return okJson({ grant: { grantId: 'tg_xyz' } }, 201);
    });
    const code = await handleToolsVerb(
      'grant',
      ['--agent', '@speedyc', '--tool', 'graphify'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.requests[1].url).toBe('http://test.local/api/tool-grants');
    const body = JSON.parse(captured.requests[1].init.body);
    expect(body.granteeHandle).toBe('@speedyc');
    expect(body.toolId).toBe('tool_G');
    expect(body.scopeKind).toBe('global');
  });

  it('grant honours --scope-kind room --scope-id roomA', async () => {
    const { runtime, captured } = makeRuntime((n) => {
      if (n === 1) {
        return okJson({
          tools: [{ toolId: 'tool_G', toolSlug: 'x', retiredAtMs: null }]
        });
      }
      return okJson({ grant: { grantId: 'tg_x' } }, 201);
    });
    await handleToolsVerb(
      'grant',
      [
        '--agent',
        '@x',
        '--tool',
        'x',
        '--scope-kind',
        'room',
        '--scope-id',
        'roomA'
      ],
      runtime,
      { CliInputError }
    );
    const body = JSON.parse(captured.requests[1].init.body);
    expect(body.scopeKind).toBe('room');
    expect(body.scopeId).toBe('roomA');
  });

  it('grant rejects invalid --scope-kind', async () => {
    const { runtime } = makeRuntime((n) => {
      if (n === 1) {
        return okJson({
          tools: [{ toolId: 'tool_G', toolSlug: 'x', retiredAtMs: null }]
        });
      }
      return okJson({});
    });
    await expect(
      handleToolsVerb(
        'grant',
        ['--agent', '@x', '--tool', 'x', '--scope-kind', 'planet'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--scope-kind/);
  });

  it('revoke DELETEs /api/tool-grants and reports count', async () => {
    const { runtime, captured } = makeRuntime((n) => {
      if (n === 1) {
        return okJson({
          tools: [{ toolId: 'tool_G', toolSlug: 'x', retiredAtMs: null }]
        });
      }
      return okJson({ revokedCount: 2 });
    });
    const code = await handleToolsVerb(
      'revoke',
      ['--agent', '@x', '--tool', 'x'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.requests[1].init.method).toBe('DELETE');
    expect(captured.stdout.join('\n')).toContain('Revoked 2');
  });
});

describe('ant tools import-skills', () => {
  function makeFakeFs(layout) {
    return {
      readdirSync: (path) => {
        const entries = layout[path];
        if (!entries) throw new Error(`no entries for ${path}`);
        return entries.map((e) => e.name);
      },
      statSync: (path) => {
        const parent = Object.keys(layout).find((root) =>
          path.startsWith(`${root}/`) && !path.slice(root.length + 1).includes('/')
        );
        if (parent) {
          const entry = layout[parent].find((e) => path.endsWith(`/${e.name}`));
          if (entry) return { isDirectory: () => entry.isDir };
        }
        return { isDirectory: () => true };
      },
      existsSync: (path) => layout._files?.[path] !== undefined,
      readFileSync: (path) => {
        const content = layout._files?.[path];
        if (content === undefined) throw new Error(`no file ${path}`);
        return content;
      }
    };
  }

  it('--dry-run lists discovered skills without POSTing', async () => {
    const layout = {
      '/skills-root': [
        { name: 'graphify', isDir: true },
        { name: 'notify-me', isDir: true },
        { name: 'README.md', isDir: false }
      ],
      _files: {
        '/skills-root/graphify/SKILL.md':
          '---\nname: graphify\nversion: 0.3.1\ndescription: "Build a graph"\n---\nBody',
        '/skills-root/notify-me/SKILL.md':
          '---\nname: notify-me\ndescription: Push to JWPK iPhone\n---\nBody'
      }
    };
    const fs = makeFakeFs(layout);
    const { runtime, captured } = makeRuntime(() => okJson({}));
    runtime.fsImpl = fs;
    runtime.skillSourcePaths = ['/skills-root'];
    const code = await handleToolsVerb('import-skills', ['--dry-run'], runtime, {
      CliInputError
    });
    expect(code).toBe(0);
    expect(captured.requests).toHaveLength(0);
    const out = captured.stdout.join('\n');
    expect(out).toContain('Would register 2');
    expect(out).toContain('graphify');
    expect(out).toContain('notify-me');
  });

  it('--commit POSTs one tool per skill and reports success count', async () => {
    const layout = {
      '/skills-root': [{ name: 'graphify', isDir: true }],
      _files: {
        '/skills-root/graphify/SKILL.md':
          '---\nname: graphify\nversion: 0.3.1\n---\nBody'
      }
    };
    const fs = makeFakeFs(layout);
    const { runtime, captured } = makeRuntime(() => okJson({ tool: { toolId: 't_1' } }, 201));
    runtime.fsImpl = fs;
    runtime.skillSourcePaths = ['/skills-root'];
    const code = await handleToolsVerb('import-skills', ['--commit'], runtime, {
      CliInputError
    });
    expect(code).toBe(0);
    expect(captured.requests).toHaveLength(1);
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.toolSlug).toBe('graphify');
    expect(body.kind).toBe('skill');
    expect(captured.stdout.join('\n')).toContain('Registered 1');
  });

  it('requires exactly one of --dry-run or --commit', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleToolsVerb('import-skills', [], runtime, { CliInputError })
    ).rejects.toThrow(/--dry-run/);
    await expect(
      handleToolsVerb(
        'import-skills',
        ['--dry-run', '--commit'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/--dry-run/);
  });

  it('reports "(no SKILL.md files found)" when none discovered', async () => {
    const layout = { '/skills-root': [], _files: {} };
    const fs = makeFakeFs(layout);
    const { runtime, captured } = makeRuntime(() => okJson({}));
    runtime.fsImpl = fs;
    runtime.skillSourcePaths = ['/skills-root'];
    await handleToolsVerb('import-skills', ['--dry-run'], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toContain('no SKILL.md');
  });

  it('reports "(no skills directories found ...)" when no source paths', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    runtime.skillSourcePaths = [];
    await handleToolsVerb('import-skills', ['--dry-run'], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toContain('no skills directories');
  });

  it('--commit returns 1 when any registration fails', async () => {
    const layout = {
      '/skills-root': [{ name: 'good', isDir: true }, { name: 'bad', isDir: true }],
      _files: {
        '/skills-root/good/SKILL.md': '---\nname: good\n---\nBody',
        '/skills-root/bad/SKILL.md': '---\nname: bad\n---\nBody'
      }
    };
    const fs = makeFakeFs(layout);
    let callCount = 0;
    const { runtime, captured } = makeRuntime(() => {
      callCount += 1;
      if (callCount === 1) return okJson({ tool: { toolId: 't_g' } }, 201);
      return notOk(500, 'oops');
    });
    runtime.fsImpl = fs;
    runtime.skillSourcePaths = ['/skills-root'];
    const code = await handleToolsVerb('import-skills', ['--commit'], runtime, {
      CliInputError
    });
    expect(code).toBe(1);
    expect(captured.stdout.join('\n')).toMatch(/Registered 1.*1 failed/);
  });
});

describe('SKILL.md frontmatter parser', () => {
  it('parses basic key/value pairs', () => {
    const parsed = _internals.parseSkillFrontmatter(
      '---\nname: graphify\nversion: 0.3.1\n---\nBody text'
    );
    expect(parsed).toEqual({ name: 'graphify', version: '0.3.1' });
  });

  it('strips surrounding quotes from values', () => {
    const parsed = _internals.parseSkillFrontmatter(
      '---\nname: "graphify"\ndescription: \'Build graphs\'\n---\nBody'
    );
    expect(parsed?.name).toBe('graphify');
    expect(parsed?.description).toBe('Build graphs');
  });

  it('returns null when no frontmatter present', () => {
    expect(_internals.parseSkillFrontmatter('Just body, no front')).toBeNull();
  });

  it('returns null when closing --- missing', () => {
    expect(_internals.parseSkillFrontmatter('---\nname: x\nbody never closes')).toBeNull();
  });
});

describe('dispatcher wiring', () => {
  it('runner.run("tools list") dispatches to handleToolsVerb', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ tools: [] });
      },
      writeOut: () => {},
      writeErr: () => {}
    });
    const code = await runner.run(['tools', 'list']);
    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/tools');
  });
});
