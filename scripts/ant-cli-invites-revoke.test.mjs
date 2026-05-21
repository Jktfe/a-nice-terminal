// CLI tests for `ant invite revoke` subverb (M3.7b).
// Split out of scripts/ant-cli-invites.test.mjs to keep that file under the
// 240L soft cap.
import { describe, expect, it } from 'vitest';
import { handleInviteVerb } from './ant-cli-invites.mjs';

class CliInputError extends Error {}
const ADMIN_TOKEN = 'admin-token-very-secret';

function makeRuntime(responseBuilder) {
  const captured = { posts: [], gets: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET').toUpperCase() === 'POST') captured.posts.push({ url, init });
    else captured.gets.push({ url, init });
    return responseBuilder(url, init);
  };
  return {
    runtime: { fetchImpl, serverUrl: 'http://test.local', writeOut: (l) => captured.stdout.push(l), writeErr: (l) => captured.stderr.push(l) },
    captured
  };
}
const okJson = (payload) => ({ ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) });

describe('ant invite revoke (M3.7b)', () => {
  it('R8: revoke posts to /api/chat-invites/:id/revoke with admin bearer', async () => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    const { runtime, captured } = makeRuntime(() => okJson({ invite_id: 'inv_42', revoked: true }));
    await handleInviteVerb('revoke', ['--invite-id', 'inv_42'], runtime, { CliInputError });
    expect(captured.posts[0].url).toBe('http://test.local/api/chat-invites/inv_42/revoke');
    expect(captured.posts[0].init.method).toBe('POST');
    expect(captured.posts[0].init.headers.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    expect(captured.stdout[0]).toMatch(/Revoked invite inv_42/);
    delete process.env.ANT_ADMIN_TOKEN;
  });

  it('R9: revoke without --invite-id rejects before fetch', async () => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleInviteVerb('revoke', [], runtime, { CliInputError })
    ).rejects.toThrow(/missing required flag --invite-id/);
    expect(captured.posts).toHaveLength(0);
    delete process.env.ANT_ADMIN_TOKEN;
  });
});
