/**
 * Automated tests for scripts/ant-cli.mjs.
 *
 * No real server is started. Every call goes through a mocked fetch that
 * records the request and returns a canned Response. Stdout and stderr are
 * captured into arrays so we can assert on what the CLI told the operator.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';

function makeJsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeTextResponse(text, status) {
  return new Response(text, { status });
}

function setupRunner({ fetchReplies = [], throwOnFetch = null, serverUrl = 'http://localhost:4321' } = {}) {
  const writtenOut = [];
  const writtenErr = [];
  const fetchCalls = [];
  let replyIndex = 0;

  const fetchImpl = async (url, init) => {
    fetchCalls.push({ url, init });
    if (throwOnFetch) throw throwOnFetch;
    const reply = fetchReplies[replyIndex++] ?? makeJsonResponse({ ok: true });
    return reply;
  };

  const runner = makeCliRunner({
    fetchImpl,
    writeOut: (line) => writtenOut.push(line),
    writeErr: (line) => writtenErr.push(line),
    serverUrl
  });

  return { runner, writtenOut, writtenErr, fetchCalls };
}

describe('ant-cli', () => {
  describe('rooms list', () => {
    it('GETs /api/chat-rooms and prints each room', async () => {
      const { runner, writtenOut, fetchCalls } = setupRunner({
        fetchReplies: [
          makeJsonResponse({
            chatRooms: [
              { id: 'r1', name: 'one', members: [{ handle: '@you' }] },
              { id: 'r2', name: 'two', members: [{ handle: '@you' }, { handle: '@ai' }] }
            ]
          })
        ]
      });
      const exitCode = await runner.run(['rooms', 'list']);
      expect(exitCode).toBe(0);
      expect(fetchCalls[0].url).toBe('http://localhost:4321/api/chat-rooms');
      expect(writtenOut[0]).toContain('r1');
      expect(writtenOut[0]).toContain('one');
      expect(writtenOut[1]).toContain('r2');
    });
  });

  describe('rooms create', () => {
    it('rejects a missing name', async () => {
      const { runner, writtenErr } = setupRunner();
      const exitCode = await runner.run(['rooms', 'create']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('needs a name');
    });

    it('supports multi-word room names', async () => {
      const { runner, fetchCalls } = setupRunner({
        fetchReplies: [makeJsonResponse({ chatRoom: { id: 'r1', name: 'a long room' } }, 201)]
      });
      const exitCode = await runner.run(['rooms', 'create', 'a', 'long', 'room']);
      expect(exitCode).toBe(0);
      const body = JSON.parse(fetchCalls[0].init.body);
      expect(body.name).toBe('a long room');
    });

    // Dogfood finding #2 (2026-05-25): `ant rooms create --name X` was
    // inconsistent with `ant router start --room --handle`.
    it('accepts --name flag form for consistency with sibling verbs', async () => {
      const { runner, fetchCalls } = setupRunner({
        fetchReplies: [makeJsonResponse({ chatRoom: { id: 'r1', name: 'flag-named' } }, 201)]
      });
      const exitCode = await runner.run(['rooms', 'create', '--name', 'flag-named']);
      expect(exitCode).toBe(0);
      const body = JSON.parse(fetchCalls[0].init.body);
      expect(body.name).toBe('flag-named');
    });

    // Dogfood finding #2: error message includes inline usage so operator
    // sees actionable syntax even though top-level help still dumps from
    // the central catch-all.
    it('error message for missing name includes inline usage hint', async () => {
      const { runner, writtenErr } = setupRunner();
      const exitCode = await runner.run(['rooms', 'create']);
      expect(exitCode).toBe(1);
      const stderrStr = writtenErr.join('\n');
      expect(stderrStr).toMatch(/ant rooms create "<NAME>"/);
      expect(stderrStr).toMatch(/--name "<NAME>"/);
    });

    // Dogfood finding #3 (2026-05-25): success message gets a next-step
    // nudge so an operator coming from "open a room → bring in a codex"
    // doesn't have to grep ant --help for the next move.
    it('success message includes next-step nudges', async () => {
      const { runner, writtenOut } = setupRunner({
        fetchReplies: [makeJsonResponse({ chatRoom: { id: 'r1', name: 'fresh' } }, 201)]
      });
      const exitCode = await runner.run(['rooms', 'create', 'fresh']);
      expect(exitCode).toBe(0);
      const stdoutStr = writtenOut.join('\n');
      expect(stdoutStr).toMatch(/Created r1 fresh/);
      expect(stdoutStr).toMatch(/Next steps:/);
      expect(stdoutStr).toMatch(/ant agents bring-in --room r1/);
      expect(stdoutStr).toMatch(/ant rooms invite r1/);
      expect(stdoutStr).toMatch(/\/rooms\/r1/);
    });
  });

  describe('rooms post', () => {
    it('rejects an empty message', async () => {
      const { runner, writtenErr } = setupRunner();
      const exitCode = await runner.run(['rooms', 'post', 'r1']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('non-empty message');
    });

    it('POSTs the body and pidChain without overriding the server-resolved author', async () => {
      const { runner, fetchCalls } = setupRunner({
        fetchReplies: [makeJsonResponse({ message: { id: 'm1' } }, 201)]
      });
      const exitCode = await runner.run(['rooms', 'post', 'r1', 'hello', 'there']);
      expect(exitCode).toBe(0);
      expect(fetchCalls[0].url).toBe('http://localhost:4321/api/chat-rooms/r1/messages');
      const body = JSON.parse(fetchCalls[0].init.body);
      expect(body.body).toBe('hello there');
      expect(body.authorHandle).toBeUndefined();
      expect(Array.isArray(body.pidChain)).toBe(true);
      expect(body.pidChain.length).toBeGreaterThan(0);
    });
  });

  describe('rooms break', () => {
    it('POSTs an empty body when no reason is given', async () => {
      const { runner, fetchCalls } = setupRunner({
        fetchReplies: [makeJsonResponse({ message: { id: 'b1', body: 'Context break by @cli.' } }, 201)]
      });
      const exitCode = await runner.run(['rooms', 'break', 'r1']);
      expect(exitCode).toBe(0);
      expect(fetchCalls[0].init.body).toBe('');
    });

    it('POSTs reason in the body when given', async () => {
      const { runner, fetchCalls } = setupRunner({
        fetchReplies: [makeJsonResponse({ message: { id: 'b1', body: 'Context break: x.' } }, 201)]
      });
      await runner.run(['rooms', 'break', 'r1', 'sprint', 'change']);
      const body = JSON.parse(fetchCalls[0].init.body);
      expect(body.reason).toBe('sprint change');
    });
  });

  describe('error reporting', () => {
    it('preserves the server error message on a non-2xx JSON body', async () => {
      const { runner, writtenErr } = setupRunner({
        fetchReplies: [makeJsonResponse({ message: 'Room not found.' }, 404)]
      });
      const exitCode = await runner.run(['rooms', 'members', 'unknown']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('Room not found');
      expect(writtenErr.join(' ')).toContain('404');
    });

    it('handles a non-JSON error body without crashing', async () => {
      const { runner, writtenErr } = setupRunner({
        fetchReplies: [makeTextResponse('plain text error', 500)]
      });
      const exitCode = await runner.run(['rooms', 'list']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('500');
    });

    it('produces a friendly message when the network call fails', async () => {
      const { runner, writtenErr } = setupRunner({
        throwOnFetch: new Error('ECONNREFUSED 127.0.0.1:4321')
      });
      const exitCode = await runner.run(['rooms', 'list']);
      expect(exitCode).toBe(1);
      const fullStderr = writtenErr.join(' ');
      expect(fullStderr).toContain('Cannot reach server');
      expect(fullStderr).toContain('http://localhost:4321');
    });
  });

  describe('rooms members', () => {
    it('rejects a missing roomId', async () => {
      const { runner, writtenErr } = setupRunner();
      const exitCode = await runner.run(['rooms', 'members']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('needs a roomId');
    });

    it('GETs /api/chat-rooms/<id> and prints each member', async () => {
      const { runner, writtenOut, fetchCalls } = setupRunner({
        fetchReplies: [
          makeJsonResponse({
            chatRoom: {
              id: 'r1',
              members: [
                { handle: '@you', kind: 'human', joinedAt: '2026-05-12T00:00:00Z' },
                { handle: '@bot', kind: 'agent', joinedAt: '2026-05-12T00:01:00Z' }
              ]
            }
          })
        ]
      });
      const exitCode = await runner.run(['rooms', 'members', 'r1']);
      expect(exitCode).toBe(0);
      expect(fetchCalls[0].url).toBe('http://localhost:4321/api/chat-rooms/r1');
      expect(writtenOut[0]).toContain('@you');
      expect(writtenOut[1]).toContain('@bot');
    });
  });

  describe('rooms invite', () => {
    it('rejects a missing roomId or handle', async () => {
      const { runner, writtenErr } = setupRunner();
      const exitCode = await runner.run(['rooms', 'invite']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('agent handle');
    });

    it('POSTs the agentHandle to /members and confirms', async () => {
      const { runner, writtenOut, fetchCalls } = setupRunner({
        fetchReplies: [makeJsonResponse({ chatRoom: { id: 'r1' } }, 201)]
      });
      const exitCode = await runner.run(['rooms', 'invite', 'r1', '@kimi']);
      expect(exitCode).toBe(0);
      expect(fetchCalls[0].url).toBe('http://localhost:4321/api/chat-rooms/r1/members');
      expect(JSON.parse(fetchCalls[0].init.body).agentHandle).toBe('@kimi');
      expect(writtenOut.join(' ')).toContain('@kimi');
    });
  });

  describe('rooms messages', () => {
    it('rejects a missing roomId', async () => {
      const { runner, writtenErr } = setupRunner();
      const exitCode = await runner.run(['rooms', 'messages']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('needs a roomId');
    });

    it('GETs the messages and renders human, agent and break rows', async () => {
      const { runner, writtenOut, fetchCalls } = setupRunner({
        fetchReplies: [
          makeJsonResponse({
            messages: [
              { id: 'm1', kind: 'human', authorDisplayName: 'James', body: 'hi', postedAt: 'T1' },
              { id: 'm2', kind: 'system-break', authorDisplayName: 'System', body: 'BREAK', postedAt: 'T2' }
            ]
          })
        ]
      });
      const exitCode = await runner.run(['rooms', 'messages', 'r1']);
      expect(exitCode).toBe(0);
      const url = new URL(fetchCalls[0].url);
      expect(`${url.origin}${url.pathname}`).toBe('http://localhost:4321/api/chat-rooms/r1/messages');
      expect(url.searchParams.get('pidChain')).toBeTruthy();
      expect(writtenOut[0]).toContain('James');
      expect(writtenOut[1]).toContain('━━');
    });
  });

  describe('rooms break missing-arg', () => {
    it('rejects a missing roomId', async () => {
      const { runner, writtenErr } = setupRunner();
      const exitCode = await runner.run(['rooms', 'break']);
      expect(exitCode).toBe(1);
      expect(writtenErr.join(' ')).toContain('needs a roomId');
    });
  });

  describe('error body truncation', () => {
    it('truncates a very long non-JSON body in the stderr line', async () => {
      const veryLongHtmlPage = '<html>' + 'x'.repeat(2000) + '</html>';
      const { runner, writtenErr } = setupRunner({
        fetchReplies: [makeTextResponse(veryLongHtmlPage, 500)]
      });
      const exitCode = await runner.run(['rooms', 'list']);
      expect(exitCode).toBe(1);
      const fullStderr = writtenErr.join(' ');
      expect(fullStderr).toContain('truncated');
      // The truncated line should be well under the original 2000-char body.
      expect(fullStderr.length).toBeLessThan(800);
    });
  });

  describe('help', () => {
    it('prints usage and exits 0 on help', async () => {
      const { runner, writtenOut } = setupRunner();
      const exitCode = await runner.run(['help']);
      expect(exitCode).toBe(0);
      expect(writtenOut.join('\n')).toContain('ant — fresh-ant CLI');
      expect(writtenOut.join('\n')).toContain('  room members');
    });

    it('prints usage and exits 1 on unknown verb', async () => {
      const { runner } = setupRunner();
      const exitCode = await runner.run(['stretch']);
      expect(exitCode).toBe(1);
    });

    it('help advertises docs generate --from-cli (manifest source-of-truth surface)', async () => {
      const { runner, writtenOut } = setupRunner();
      const exitCode = await runner.run(['help']);
      expect(exitCode).toBe(0);
      const helpText = writtenOut.join('\n');
      expect(helpText).toContain('docs generate --from-cli');
      expect(helpText).toContain('Generate manifest-derived markdown');
    });

    it('dispatches docs verb to ant-cli-docs.mjs handler', async () => {
      const { runner, writtenOut } = setupRunner();
      const exitCode = await runner.run(['docs', 'help']);
      expect(exitCode).toBe(0);
      expect(writtenOut.join('\n')).toContain('docs generate --from-cli');
    });
  });
});

describe('rooms create flag stripping', () => {
  it('strips --json from room name', async () => {
    const { runner, fetchCalls } = setupRunner({
      fetchReplies: [makeJsonResponse({ chatRoom: { id: 'r1', name: 'my room' } }, 201)]
    });
    const exitCode = await runner.run(['rooms', 'create', 'my', 'room', '--json']);
    expect(exitCode).toBe(0);
    const body = JSON.parse(fetchCalls[0].init.body);
    expect(body.name).toBe('my room');
  });

  // Dogfood finding #2 (2026-05-25): `--name` is now a supported flag,
  // not flag-shaped junk to strip. When both positional + --name are
  // present, the EXPLICIT flag wins — `--name` is the canonical form and
  // mirrors the rest of the CLI surface (`ant router start --room
  // --handle`, etc.). The old "strip --name" behaviour was a workaround
  // because the flag wasn't honoured; the workaround is no longer needed.
  it('--name wins over positional when both are present (flag is explicit)', async () => {
    const { runner, fetchCalls } = setupRunner({
      fetchReplies: [makeJsonResponse({ chatRoom: { id: 'r1', name: 'flag-wins' } }, 201)]
    });
    const exitCode = await runner.run(['rooms', 'create', 'real', 'name', '--name', 'flag-wins']);
    expect(exitCode).toBe(0);
    const body = JSON.parse(fetchCalls[0].init.body);
    expect(body.name).toBe('flag-wins');
  });
});

describe('rooms post flag stripping', () => {
  it('strips --json from message body', async () => {
    const { runner, fetchCalls } = setupRunner({
      fetchReplies: [makeJsonResponse({ message: { id: 'm1' } }, 201)]
    });
    const exitCode = await runner.run(['rooms', 'post', 'r1', 'hello', '--json']);
    expect(exitCode).toBe(0);
    const body = JSON.parse(fetchCalls[0].init.body);
    expect(body.body).toBe('hello');
  });
});
