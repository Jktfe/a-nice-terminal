import { afterEach, describe, expect, it } from 'vitest';
import getDb, { queries } from '../src/lib/server/db.js';
import { toSafeMemoryFtsQuery } from '../src/lib/server/memory-search.js';
import { GET } from '../src/routes/api/memories/+server.js';

const TEST_KEY = 'tests/memory-search/punctuation';

function cleanup() {
  getDb().prepare('DELETE FROM memories WHERE key = ?').run(TEST_KEY);
}

async function search(q: string) {
  const response = await GET({
    url: new URL(`https://ant.example.test/api/memories?q=${encodeURIComponent(q)}&scope=all&limit=10`),
  } as Parameters<typeof GET>[0]);
  return response.json();
}

describe('memory FTS search', () => {
  afterEach(cleanup);

  it('normalizes punctuation-heavy user queries into safe FTS terms', () => {
    expect(toSafeMemoryFtsQuery('/brain use of. memory palace')).toBe('"brain" "use" "of" "memory" "palace"');
    expect(toSafeMemoryFtsQuery('////')).toBeNull();
  });

  it('does not throw HTTP 500 for slash, colon, or path-like searches', async () => {
    cleanup();
    queries.upsertMemoryByKey(
      TEST_KEY,
      'Memory palace debugging note: /brain searches and docs/mempalace-schema.md paths must not crash FTS.',
      JSON.stringify(['test']),
      null,
      'vitest',
    );

    await expect(search('/brain')).resolves.toMatchObject({ scope: 'all' });
    await expect(search('session:ANTstorm')).resolves.toMatchObject({ scope: 'all' });
    await expect(search('docs/mempalace-schema.md')).resolves.toMatchObject({ scope: 'all' });
    await expect(search('////')).resolves.toEqual({ memories: [], scope: 'all' });
  });
});
