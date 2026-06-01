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
    expect(COMPONENT_SRC).toMatch(/aria-label={`\${entry.handle} is \${labelForStatus\(entry.status\)}`}/);
  });
});
