import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('ChatSidePanel artefacts render contract', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ChatSidePanel.svelte'),
    'utf8',
  );

  it('loads grouped artefacts from the session-scoped read-only API', () => {
    expect(source).toContain("from '$lib/shared/room-artefacts'");
    expect(source).toContain('/api/sessions/${encodeURIComponent(forSessionId)}/artefacts');
    expect(source).toContain('type RoomArtefactSummary');
  });

  it('renders a dedicated artefacts section separate from file references', () => {
    expect(source).toContain('SECTION: Artefacts');
    expect(source).toContain('SECTION: File References');
    expect(source.indexOf('SECTION: Artefacts')).toBeLessThan(source.indexOf('SECTION: File References'));
    expect(source).toContain('No linked artefacts');
  });

  it('renders configured groups and opens each item through its href', () => {
    expect(source).toContain('{#each ROOM_ARTEFACT_GROUPS as group (group.key)}');
    expect(source).toContain('href={item.href}');
    expect(source).toContain("{#if item.kind === 'plan'}");
    expect(source).toContain("{:else if item.kind === 'deck'}");
    expect(source).toContain("{:else if item.kind === 'sheet'}");
    expect(source).toContain("{:else if item.kind === 'site'}");
  });

  it('keeps the desktop right panel 15 percent wider than the original 280px', () => {
    expect(source).toContain('lg:w-[322px]');
    expect(source).toContain('15% wider');
  });
});

describe('room artefacts projection contract', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/server/room-artefacts.ts'),
    'utf8',
  );

  it('keeps plans, decks, docs, sheets, and sites on their native source registries', () => {
    expect(source).toContain('listPlanRefs(200, { includeArchived: false })');
    expect(source).toContain('listDecks()');
    expect(source).toContain('listSheets()');
    expect(source).toContain('listSiteTunnels()');
    expect(source).toContain("queries.listMemoriesByPrefix(DOC_PREFIX, 200)");
  });

  it('builds plan links back to the plan page with archived visibility preserved', () => {
    expect(source).toContain('/plan?session_id=');
    expect(source).toContain('&plan_id=');
    expect(source).toContain("plan.archived ? '&include_archived=1' : ''");
  });

  it('carries room identity through every projected artefact item', () => {
    expect(source).toContain('room_id: roomId');
    expect(source).toContain('session_id=${encodeURIComponent(roomId)}');
  });
});
