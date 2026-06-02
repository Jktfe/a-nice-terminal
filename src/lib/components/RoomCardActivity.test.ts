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

describe('RoomCardActivity display-identity invariant (room-identity hardening)', () => {
  it('renders the pill identity from the resolved handle field, not a pid', () => {
    // Identity displayed = entry.handle (server-resolved via lease ->
    // durable session in the /agent-statuses feed). The handle must be the
    // displayed token.
    expect(COMPONENT_SRC).toMatch(/shortHandle\(entry\.handle\)/);
    expect(COMPONENT_SRC).toMatch(/function shortHandle\(handle: string\)/);
  });

  it('sources status entries from the agent-statuses endpoint (no client-side identity resolution)', () => {
    expect(COMPONENT_SRC).toMatch(/\/api\/chat-rooms\/\$\{encodeURIComponent\(roomId\)\}\/agent-statuses/);
  });

  it('does not infer identity from a pid binding', () => {
    // No pid-keyed identity lookup. 'pid-cpu' is allowed ONLY as a status
    // source LABEL, never as an identity key — assert there is no pid-based
    // identity derivation (e.g. entry.pid, pidToHandle, bindingPid).
    expect(COMPONENT_SRC).not.toMatch(/entry\.pid\b/);
    expect(COMPONENT_SRC).not.toMatch(/pidToHandle|pidBinding|bindingPid|handleForPid/);
  });

  it('does not reimplement lease/owner lookup in Svelte', () => {
    // Lease resolution belongs in the server resolver (roomIdentityResolver),
    // consumed via the endpoint — never duplicated here.
    expect(COMPONENT_SRC).not.toMatch(/findRoomHandleOwnerAtTime|roomHandleLeaseStore|resolveHandleToSession/);
  });

  it('documents the display-identity invariant so the rule survives edits', () => {
    expect(COMPONENT_SRC).toMatch(/DISPLAY IDENTITY INVARIANT/);
  });
});
