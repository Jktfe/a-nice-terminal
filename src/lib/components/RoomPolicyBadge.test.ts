import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const COMPONENT_SRC = readFileSync(
  fileURLToPath(new URL('./RoomPolicyBadge.svelte', import.meta.url)),
  'utf8'
);

describe('RoomPolicyBadge', () => {
  it('fetches policy from the read-only policy endpoint (consumes A via endpoint, no reimpl)', () => {
    // Must hit the endpoint that wraps getRoomPolicy — never reimplement
    // lease/policy logic in Svelte.
    expect(COMPONENT_SRC).toMatch(/\/api\/chat-rooms\/\$\{encodeURIComponent\(roomId\)\}\/policy/);
    // No client-side policy decision logic leaking in (decideRead/Join etc.)
    expect(COMPONENT_SRC).not.toMatch(/decideRead|decideJoin|decidePost|allowedByState/);
  });

  it('renders both policy axes — read and join — separately', () => {
    expect(COMPONENT_SRC).toMatch(/readPolicy/);
    expect(COMPONENT_SRC).toMatch(/joinPolicy/);
    // The badge labels each axis so the two are not conflated.
    expect(COMPONENT_SRC).toMatch(/read/i);
    expect(COMPONENT_SRC).toMatch(/join/i);
  });

  it('maps each of the four policy states to a human label (open/closed/invite/permitted)', () => {
    expect(COMPONENT_SRC).toMatch(/open/);
    expect(COMPONENT_SRC).toMatch(/closed/);
    expect(COMPONENT_SRC).toMatch(/invite/);
    // 'allowed' surfaces to the user as "permitted" per A's synonym note.
    expect(COMPONENT_SRC).toMatch(/permitted/);
  });

  it('takes a roomId prop via $props (Svelte 5 runes)', () => {
    expect(COMPONENT_SRC).toMatch(/\$props\(\)/);
    expect(COMPONENT_SRC).toMatch(/roomId/);
  });

  it('soft-fails when the endpoint is unavailable (badge is informational)', () => {
    // A try/catch or !response.ok guard so a failed fetch does not throw.
    expect(COMPONENT_SRC).toMatch(/catch|response\.ok/);
  });
});
