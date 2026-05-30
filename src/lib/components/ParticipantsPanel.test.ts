import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import ParticipantsPanel from './ParticipantsPanel.svelte';

const PANEL_SRC = readFileSync(
  fileURLToPath(new URL('./ParticipantsPanel.svelte', import.meta.url)),
  'utf8'
);

// SSR-only smoke check (mirrors FocusModeModal.test.ts pattern). The
// archived treatment + Reclaim button are sourced from the
// /api/chat-rooms/:roomId/agent-statuses fetch which fires inside a
// browser-only $effect — so SSR can't directly assert the live render of
// the Reclaim button. Instead, this test pins the CSS classes / button
// markup that the Phase C2 patch added, so a future refactor that drops
// the styles or the reclaim handler will trip the assertion.

describe('ParticipantsPanel — Phase C2 archived treatment', () => {
  it('source template wires the archived treatment + Reclaim button', () => {
    // The archived/reclaim branches are inside an {#if isArchived} guard
    // that only fires when an agent-statuses fetch returns lifecycleStatus
    // === 'archived'. SSR can't exercise that branch without a fetch
    // shim, so we pin the source-template tokens that wire the feature
    // — a future refactor that drops them will trip this assertion.
    expect(PANEL_SRC).toMatch(/lifecycleStatus === 'archived'/);
    expect(PANEL_SRC).toMatch(/class="reclaim-btn"/);
    expect(PANEL_SRC).toMatch(/Reclaim/);
    expect(PANEL_SRC).toMatch(/archived-pill/);
    expect(PANEL_SRC).toMatch(/reclaimHandle\(member\.handle\)/);
  });

  it('does not render the Reclaim button when no statuses are loaded yet (SSR)', () => {
    // On SSR, the statuses fetch hasn't fired, so even an archived
    // member should not show a Reclaim button in the initial markup —
    // it appears after the client-side fetch lands. This is the
    // expected MVP behaviour for Phase C2 (no over-design).
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
    expect(body).not.toMatch(/>Reclaim<\/button>/);
    expect(body).not.toContain('📦 archived');
  });
});
