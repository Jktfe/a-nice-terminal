import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ParticipantsPanel from './ParticipantsPanel.svelte';

const PANEL_SRC = readFileSync(
  fileURLToPath(new URL('./ParticipantsPanel.svelte', import.meta.url)),
  'utf8'
);

// SSR-only smoke check (mirrors FocusModeModal.test.ts pattern). The archived
// treatment is sourced from the /api/chat-rooms/:roomId/agent-statuses fetch
// which fires inside a browser-only $effect — so SSR can't directly assert its
// live render. Instead, this test pins the source-template tokens that wire the
// archived treatment, so a future refactor that drops them trips the assertion.
//
// NOTE: the in-panel "Reclaim" button was removed (JWPK 2026-06-15) — flipping
// lifecycle back to 'live' from here was a misleading no-op; the real path is
// `ant reclaim` from the CLI. So this test no longer asserts any reclaim markup.

describe('ParticipantsPanel — archived treatment', () => {
  it('source template wires the archived treatment', () => {
    // The archived branch is inside an {#if isArchived} guard that only fires
    // when an agent-statuses fetch returns lifecycleStatus === 'archived'. SSR
    // can't exercise that branch without a fetch shim, so we pin the
    // source-template tokens that wire the treatment.
    expect(PANEL_SRC).toMatch(/lifecycleStatus === 'archived'/);
    expect(PANEL_SRC).toMatch(/archived-pill/);
  });

  it('does not render archived markup when no statuses are loaded yet (SSR)', () => {
    // On SSR, the statuses fetch hasn't fired, so even an archived member
    // shows no archived markup in the initial render — it appears only after
    // the client-side fetch lands.
    const { body } = render(ParticipantsPanel, {
      props: {
        roomId: 'r1',
        members: [
          {
            handle: '@codex',
            displayName: 'Codex',
            displayColor: '#000000',
            displayIcon: 'C',
            displayBackgroundStyle: 'transparent',
            kind: 'agent',
            joinedAt: '2024-01-01T00:00:00Z'
          }
        ],
        aliasesInRoom: []
      }
    });
    // No archived data yet → no archived markup in the rendered output.
    expect(body).not.toContain('📦 archived');
  });
});
