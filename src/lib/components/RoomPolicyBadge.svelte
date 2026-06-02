<!--
  RoomPolicyBadge — workstream-C DISPLAY layer (room-identity hardening).

  Compact, read-only badge showing a room's two-axis policy:
    - READ  — who may see the room + its history.
    - JOIN  — who may take a handle lease + post.
  Each axis is one of four states (open / permitted / invite / closed),
  fetched from GET /api/chat-rooms/:roomId/policy, which wraps A's
  getRoomPolicy. This component is purely presentational: it NEVER
  reimplements lease or policy decision logic — the read/join/post
  decisions live in roomAccessGate on the server. The badge just
  surfaces the posture so a human can see "watch widely, act narrowly"
  at a glance.

  'allowed' is rendered as "permitted" (A's documented user-facing synonym).
-->
<script lang="ts">
  type RoomPolicyState = 'open' | 'allowed' | 'invite' | 'closed';
  type RoomPolicy = { joinPolicy: RoomPolicyState; readPolicy: RoomPolicyState };

  type Props = {
    roomId: string;
  };

  let { roomId }: Props = $props();

  let policy = $state<RoomPolicy | null>(null);

  // User-facing label per axis state. 'allowed' surfaces as "permitted"
  // (A's synonym). Kept here as pure display mapping — not a decision.
  function labelForState(state: RoomPolicyState): string {
    switch (state) {
      case 'open':
        return 'open';
      case 'allowed':
        return 'permitted';
      case 'invite':
        return 'invite';
      case 'closed':
        return 'closed';
    }
  }

  function titleForState(axis: 'read' | 'join', state: RoomPolicyState): string {
    const who: Record<RoomPolicyState, string> = {
      open: 'anyone',
      allowed: 'entitled members',
      invite: 'invited only',
      closed: 'existing members only'
    };
    const verb = axis === 'read' ? 'see this room + history' : 'take a handle + post';
    return `${axis}: ${who[state]} may ${verb}`;
  }

  async function refreshPolicy() {
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/policy`);
      if (!response.ok) return;
      const body = (await response.json()) as RoomPolicy;
      policy = body;
    } catch {
      /* soft-fail: badge is informational, the rest of the header still renders */
    }
  }

  $effect(() => {
    if (!roomId) return;
    void refreshPolicy();
  });
</script>

{#if policy}
  <span class="room-policy-badge" aria-label="Room policy">
    <span
      class={`policy-axis read-${policy.readPolicy}`}
      title={titleForState('read', policy.readPolicy)}
    >
      <span class="policy-axis-label">read</span>
      <span class="policy-axis-state">{labelForState(policy.readPolicy)}</span>
    </span>
    <span
      class={`policy-axis join-${policy.joinPolicy}`}
      title={titleForState('join', policy.joinPolicy)}
    >
      <span class="policy-axis-label">join</span>
      <span class="policy-axis-state">{labelForState(policy.joinPolicy)}</span>
    </span>
  </span>
{/if}

<style>
  .room-policy-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    min-width: 0;
  }
  .policy-axis {
    display: inline-flex;
    align-items: center;
    gap: 0.2rem;
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-soft);
    font-size: 0.68rem;
    font-weight: 800;
    white-space: nowrap;
  }
  .policy-axis-label {
    opacity: 0.7;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    font-size: 0.6rem;
  }
  .policy-axis-state {
    color: var(--ink-strong);
  }
  /* Posture tinting: open is permissive (warm), closed is locked (cool/muted),
     invite/permitted are the intermediate gated states. Read + join share the
     palette so the two axes are visually comparable at a glance. */
  .policy-axis.read-open,
  .policy-axis.join-open {
    border-color: color-mix(in srgb, #16a34a 34%, var(--surface-edge));
    background: color-mix(in srgb, #16a34a 10%, var(--surface-card));
    color: #15803d;
  }
  .policy-axis.read-closed,
  .policy-axis.join-closed {
    border-color: color-mix(in srgb, #6b7280 40%, var(--surface-edge));
    background: color-mix(in srgb, #6b7280 12%, var(--surface-card));
    color: #4b5563;
  }
  .policy-axis.read-invite,
  .policy-axis.join-invite {
    border-color: color-mix(in srgb, #0a85f0 30%, var(--surface-edge));
    background: color-mix(in srgb, #0a85f0 9%, var(--surface-card));
    color: #2563eb;
  }
  .policy-axis.read-allowed,
  .policy-axis.join-allowed {
    border-color: color-mix(in srgb, #f0a020 32%, var(--surface-edge));
    background: color-mix(in srgb, #f0a020 11%, var(--surface-card));
    color: #b9770f;
  }
</style>
