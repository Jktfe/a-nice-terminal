import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createTerminalRecord } from '$lib/server/terminalRecordsStore';

const TEST_ADMIN_TOKEN = 'terminal-access-test-token';
const PREV_ADMIN_TOKEN = process.env.ANT_ADMIN_TOKEN;

beforeEach(() => {
  process.env.ANT_ADMIN_TOKEN = TEST_ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  if (PREV_ADMIN_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_ADMIN_TOKEN;
});

async function callGet(terminalId: string, withAuth = true): Promise<Response> {
  const headers = withAuth ? { authorization: `Bearer ${TEST_ADMIN_TOKEN}` } : undefined;
  try {
    return (await GET({
      params: { id: terminalId },
      request: new Request(`http://localhost/api/terminals/${terminalId}/access`, { headers }),
      url: new URL(`http://localhost/api/terminals/${terminalId}/access`)
    } as unknown as Parameters<typeof GET>[0])) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('GET /api/terminals/:id/access', () => {
  it('rejects anonymous reads before exposing tmux attach commands', async () => {
    createTerminalRecord({ sessionId: 't_codex', name: 'Codex', tmuxTargetPane: 'codex-session:0.0' });
    const response = await callGet('t_codex', false);
    expect(response.status).toBe(401);
  });

  it('returns tmux attach commands for a terminal record', async () => {
    createTerminalRecord({ sessionId: 't_codex', name: 'Codex', tmuxTargetPane: 'codex-session:0.0' });
    const response = await callGet('t_codex');
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.tmuxSession).toBe('codex-session');
    expect(body.commands.localTmux).toBe("tmux attach-session -t 'codex-session'");
    expect(body.commands.sshTmux).toContain('tmux attach-session');
    expect(body.commands.iterm2).toContain('iTerm2');
    expect(body.commands.ghostty).toContain('Ghostty');
  });

  it('returns 404 for unknown terminals', async () => {
    const response = await callGet('missing');
    expect(response.status).toBe(404);
  });
});
