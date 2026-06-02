import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// RoomHealthPanel is a NEW read-only surface (workstream C). Following the
// repo convention for Svelte component tests (see RoomCardActivity.test.ts),
// these are source-shape assertions on the component, not a jsdom render.

const COMPONENT_SRC = readFileSync(
  fileURLToPath(new URL('./RoomHealthPanel.svelte', import.meta.url)),
  'utf8'
);

describe('RoomHealthPanel', () => {
  it('fetches the read-only /api/room-health endpoint', () => {
    expect(COMPONENT_SRC).toMatch(/\/api\/room-health/);
    expect(COMPONENT_SRC).toMatch(/async function refresh/);
  });

  it('polls every ~30s via a cleaned-up interval (mirrors RoomCardActivity)', () => {
    expect(COMPONENT_SRC).toMatch(/pollIntervalMs/);
    expect(COMPONENT_SRC).toMatch(/30_000/);
    expect(COMPONENT_SRC).toMatch(/setInterval\(refresh/);
    expect(COMPONENT_SRC).toMatch(/clearInterval/);
  });

  it('renders a summary of healthy vs broken', () => {
    expect(COMPONENT_SRC).toMatch(/summary/);
    expect(COMPONENT_SRC).toMatch(/healthy/);
    expect(COMPONENT_SRC).toMatch(/broken/);
  });

  it('renders one row per terminal with green/amber-red treatment keyed on healthy', () => {
    expect(COMPONENT_SRC).toMatch(/#each terminals/);
    expect(COMPONENT_SRC).toMatch(/entry\.healthy/);
    expect(COMPONENT_SRC).toMatch(/entry\.brokenReason/);
  });

  it('maps each brokenReason to a human-readable label', () => {
    expect(COMPONENT_SRC).toMatch(/no-handle/);
    expect(COMPONENT_SRC).toMatch(/no-membership/);
    expect(COMPONENT_SRC).toMatch(/dangling-linked-room/);
  });

  it('soft-fails the fetch so the panel stays mounted', () => {
    expect(COMPONENT_SRC).toMatch(/catch/);
  });
});
