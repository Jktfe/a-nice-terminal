import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/settings load', () => {
  it('marks operator file settings manageable for the operator browser viewer', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      if (url === '/api/capabilities') {
        return jsonResponse({ operatorHandle: '@JWPK', viewerHandle: '@JWPK' });
      }
      return jsonResponse({}, 404);
    });

    const data = await load({ fetch } as unknown as Parameters<typeof load>[0]);

    expect(data).toMatchObject({ canManageOperatorFileSettings: true });
  });

  it('does not mark operator file settings manageable for an agent browser viewer', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/skills') return jsonResponse({ skills: [] });
      if (url === '/api/capabilities') {
        return jsonResponse({ operatorHandle: '@JWPK', viewerHandle: '@newantcodexfixer' });
      }
      return jsonResponse({}, 404);
    });

    const data = await load({ fetch } as unknown as Parameters<typeof load>[0]);

    expect(data).toMatchObject({ canManageOperatorFileSettings: false });
  });

  it('threads the operator-file-settings gate into the deck and asset cards', () => {
    const page = readFileSync('src/routes/settings/+page.svelte', 'utf8');
    expect(page).toContain('<DeckRootsCard canManage={canManageOperatorFileSettings} />');
    expect(page).toContain('<AssetFoldersCard canManage={canManageOperatorFileSettings} />');

    const deckCard = readFileSync('src/lib/components/DeckRootsCard.svelte', 'utf8');
    expect(deckCard).toContain('!browser || !canManage');
    expect(deckCard).toContain("fetch('/api/deck-settings')");

    const assetCard = readFileSync('src/lib/components/AssetFoldersCard.svelte', 'utf8');
    expect(assetCard).toContain('!browser || !canManage');
    expect(assetCard).toContain("fetch('/api/asset-settings')");
  });
});
