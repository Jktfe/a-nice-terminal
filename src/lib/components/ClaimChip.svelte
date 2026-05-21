<!--
  ClaimChip — read-only display of the 🖐️/🤝/👐 claim state on a
  message. Rendered inline next to the message header so an operator
  scanning the room sees who's looking, who's working, and who's
  explicitly passed without opening the message.

  Reads from the entity_claims ledger via props — no per-row fetch.
  MessageList does one bulk GET when the message set changes and passes
  the per-id slice down. The chip stays inert in this slice; click-to-
  claim (POST /claims with 🖐️/🤝/👐) lands in a follow-up commit.

  Visual contract:
    - 🖐️ (looking) chips show in muted ink, smallest weight.
    - 🤝 (working) chip carries the active claimant + countdown until
      expiry. Brainstorm soft-claim renders amber; heads-down hard-
      claim renders red (mode is passed in by the parent; chip itself
      doesn't query room mode).
    - 👐 (pass) chips render in a strikethrough-grey style as "not
      claiming" hint.

  Per the spec (ask_hj2ubjbum8dmpce8dc1): the ledger is the source of
  truth, the chip echoes it.
-->
<script lang="ts">
  import type { EntityClaim, ClaimKind } from '$lib/server/entityClaimStore';

  type Props = {
    claims: EntityClaim[];
    /** Room mode informs whether the 🤝 working claim is soft (brainstorm)
     *  or hard (heads-down). Defaults to soft. */
    roomMode?: 'brainstorm' | 'heads-down' | 'closed';
  };

  let { claims = [], roomMode = 'brainstorm' }: Props = $props();

  // Group claims by kind. Looking + pass can have multiple agents
  // simultaneously (each claimant is a distinct row); working is
  // strictly singleton by uniqueness constraint — at most one active
  // row, plus any pending-conflict logging.
  const lookingClaims = $derived(claims.filter((c) => c.claim_kind === 'looking'));
  const workingClaim = $derived(claims.find((c) => c.claim_kind === 'working') ?? null);
  const passClaims = $derived(claims.filter((c) => c.claim_kind === 'pass'));

  function nowMs(): number {
    return Date.now();
  }

  /** Compact "12m left" / "1h 14m left" / "indefinite" copy for working
   *  claims, taking the current wall clock into account. */
  function remainingLabel(expiresAtMs: number | null): string {
    if (expiresAtMs === null) return 'indefinite';
    const remaining = expiresAtMs - nowMs();
    if (remaining <= 0) return 'expiring';
    const totalSeconds = Math.floor(remaining / 1000);
    if (totalSeconds < 60) return `${totalSeconds}s left`;
    const minutes = Math.floor(totalSeconds / 60);
    if (minutes < 60) return `${minutes}m left`;
    const hours = Math.floor(minutes / 60);
    const remMinutes = minutes - hours * 60;
    return remMinutes > 0 ? `${hours}h ${remMinutes}m left` : `${hours}h left`;
  }

  function joinedHandleList(items: EntityClaim[]): string {
    if (items.length === 0) return '';
    if (items.length <= 3) return items.map((c) => c.claimed_by_handle).join(', ');
    return `${items.slice(0, 2).map((c) => c.claimed_by_handle).join(', ')} +${items.length - 2} more`;
  }

  const hasAny = $derived(
    lookingClaims.length > 0 || workingClaim !== null || passClaims.length > 0
  );
</script>

{#if hasAny}
  <span class="claim-strip" aria-label="Claim state">
    {#if lookingClaims.length > 0}
      <span class="claim-pill claim-looking" title={`Looking: ${joinedHandleList(lookingClaims)}`}>
        <span class="claim-emoji" aria-hidden="true">🖐️</span>
        <span class="claim-detail">{joinedHandleList(lookingClaims)}</span>
      </span>
    {/if}
    {#if workingClaim}
      <span
        class={`claim-pill claim-working claim-working-${roomMode}`}
        title={`Working: ${workingClaim.claimed_by_handle}`}
      >
        <span class="claim-emoji" aria-hidden="true">🤝</span>
        <span class="claim-detail">
          <span class="claim-handle">{workingClaim.claimed_by_handle}</span>
          <span class="claim-countdown">·</span>
          <span class="claim-countdown">{remainingLabel(workingClaim.expires_at_ms)}</span>
        </span>
      </span>
    {/if}
    {#if passClaims.length > 0}
      <span class="claim-pill claim-pass" title={`Passed: ${joinedHandleList(passClaims)}`}>
        <span class="claim-emoji" aria-hidden="true">👐</span>
        <span class="claim-detail">{joinedHandleList(passClaims)}</span>
      </span>
    {/if}
  </span>
{/if}

<style>
  .claim-strip {
    display: inline-flex;
    gap: 0.3rem;
    margin-left: 0.4rem;
    flex-wrap: wrap;
  }
  .claim-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--surface-edge);
    background: var(--surface-card);
    color: var(--ink-soft);
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  }
  .claim-emoji {
    font-size: 0.85rem;
    line-height: 1;
  }
  .claim-detail {
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.68rem;
  }
  .claim-handle {
    font-weight: 700;
  }
  .claim-countdown {
    color: var(--ink-soft);
  }

  /* 🖐️ looking — quiet, advisory. */
  .claim-looking {
    border-color: color-mix(in srgb, var(--ink-soft) 35%, transparent);
    background: color-mix(in srgb, var(--ink-soft) 4%, var(--surface-card));
  }

  /* 🤝 working in brainstorm — amber: soft claim, others should stand
     down by convention but routing isn't gated. */
  .claim-working-brainstorm {
    border-color: color-mix(in srgb, #b45309 50%, transparent);
    background: color-mix(in srgb, #b45309 8%, var(--surface-card));
    color: #b45309;
  }
  .claim-working-brainstorm .claim-detail .claim-handle {
    color: #92400e;
  }

  /* 🤝 working in heads-down — red: hard claim, non-claimants 409 on
     send. The chip mirrors the routing-gate state. */
  .claim-working-heads-down {
    border-color: color-mix(in srgb, var(--danger, #b91c1c) 50%, transparent);
    background: color-mix(in srgb, var(--danger, #b91c1c) 8%, var(--surface-card));
    color: var(--danger, #b91c1c);
  }
  .claim-working-heads-down .claim-detail .claim-handle {
    color: var(--danger, #b91c1c);
    font-weight: 700;
  }

  /* 🤝 working in closed — fallback, matches brainstorm tone. */
  .claim-working-closed {
    border-color: color-mix(in srgb, var(--ink-soft) 40%, transparent);
    background: color-mix(in srgb, var(--ink-soft) 6%, var(--surface-card));
  }

  /* 👐 pass — strikethrough-grey, "not claiming" hint. */
  .claim-pass {
    border-color: color-mix(in srgb, var(--ink-soft) 25%, transparent);
    background: transparent;
    color: var(--ink-soft);
    opacity: 0.75;
  }
  .claim-pass .claim-detail {
    text-decoration: line-through;
    color: var(--ink-soft);
  }
</style>
