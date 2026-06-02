import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const COMPONENT_SRC = readFileSync(
  fileURLToPath(new URL('./RoomNameHeader.svelte', import.meta.url)),
  'utf8'
);

describe('RoomNameHeader policy badge mount', () => {
  it('imports and renders RoomPolicyBadge', () => {
    expect(COMPONENT_SRC).toMatch(/import RoomPolicyBadge from '\.\/RoomPolicyBadge\.svelte'/);
    expect(COMPONENT_SRC).toMatch(/<RoomPolicyBadge\b/);
  });

  it('passes the roomId through to the badge (identity-keyed, not pid)', () => {
    expect(COMPONENT_SRC).toMatch(/<RoomPolicyBadge[^>]*\{roomId\}/);
  });

  it('mounts the badge inside the title row near the existing status slot', () => {
    // The badge lives in the same title-row region as the status snippet so
    // the policy posture sits next to the realtime/activity status.
    const titleRow = COMPONENT_SRC.slice(
      COMPONENT_SRC.indexOf('<div class="title-row">'),
      COMPONENT_SRC.indexOf('</div>', COMPONENT_SRC.indexOf('<div class="title-row">'))
    );
    expect(titleRow).toMatch(/<RoomPolicyBadge\b/);
  });
});
