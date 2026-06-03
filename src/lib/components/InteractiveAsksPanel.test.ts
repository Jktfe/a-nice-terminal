import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('InteractiveAsksPanel identity wiring', () => {
  it('receives the caller handle from the room page instead of hardcoding @you', () => {
    const panelSource = readFileSync('src/lib/components/InteractiveAsksPanel.svelte', 'utf8');
    const moreMenuSource = readFileSync('src/lib/components/RoomDetailMoreMenu.svelte', 'utf8');
    const contextRailSource = readFileSync('src/lib/components/RoomDetailContextRail.svelte', 'utf8');

    expect(panelSource).toContain('actorHandle: string');
    expect(panelSource).not.toContain("const ACTOR_HANDLE = '@you'");
    expect(panelSource).toContain('actorHandle');
    expect(moreMenuSource).toContain('actorHandle={callerHandle}');
    expect(contextRailSource).toContain('actorHandle={callerHandle}');
  });
});
