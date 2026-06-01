import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const COMPONENT_SRC = readFileSync(
  fileURLToPath(new URL('./RoomCardActivity.svelte', import.meta.url)),
  'utf8'
);

describe('RoomCardActivity room-card status pills', () => {
  it('renders per-agent status pills from the agent-statuses feed', () => {
    expect(COMPONENT_SRC).toMatch(/agentStatusPills/);
    expect(COMPONENT_SRC).toMatch(/class="agent-status-pills"/);
    expect(COMPONENT_SRC).toMatch(/class={`agent-status-pill status-\${entry.status}`}/);
    expect(COMPONENT_SRC).toMatch(/aria-label={titleForStatus\(entry\)}/);
  });

  it('has a header variant for placing status pills next to the room live pill', () => {
    expect(COMPONENT_SRC).toMatch(/variant\?: 'activity' \| 'header'/);
    expect(COMPONENT_SRC).toMatch(/variant = 'activity'/);
    expect(COMPONENT_SRC).toMatch(/room-card-status-header/);
    expect(COMPONENT_SRC).toMatch(/variant === 'header'/);
  });

  it('spells out status and source context inside each pill', () => {
    expect(COMPONENT_SRC).toMatch(/statusSource\?: AgentStatusSource/);
    expect(COMPONENT_SRC).toMatch(/contextForStatus/);
    expect(COMPONENT_SRC).toMatch(/labelForStatus\(entry.status\)/);
    expect(COMPONENT_SRC).toMatch(/contextForStatus\(entry\)/);
  });
});
