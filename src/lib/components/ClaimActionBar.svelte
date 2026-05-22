<!--
  ClaimActionBar — three-emoji action bar for the JWPK claim primitive.

  Lives next to MessageReactionsBar at the bottom of every chat row.
  Reactions are acknowledgement signals (Bad/OK/Good/Celebrate/Question);
  these three are COORDINATION signals — different audience, different
  semantics. Keeping them in a separate component keeps each surface's
  contract clear.

  Per ratified ask_hj2ubjbum8dmpce8dc1:
    🖐️ looking  — "I'm reading this" — 90s TTL, advisory
    🤝 working  — "I'm doing this" — operator picks TTL via focus-style
                  picker, soft-block in brainstorm / hard-block in heads-down
    👐 pass     — "I'm NOT doing this" — persistent, routing hint

  Server endpoints (codex 13bfcf4):
    POST /api/chat-rooms/:roomId/claims    body { entity_kind, entity_id,
                                                  claim_kind, claimed_by_handle, ttl_ms? }
    PATCH /api/chat-rooms/:roomId/claims   body { claim_id, status }

  The bar reads claim state from the per-row Props (passed in by
  MessageList's bulk hydrate, same way ClaimChip reads it) so the
  buttons can highlight the caller's own active claim.
-->
<script lang="ts">
  import type { EntityClaim, ClaimKind } from '$lib/server/entityClaimStore';

  type Props = {
    roomId: string;
    messageId: string;
    asHandle: string;
    /** Same EntityClaim[] slice as ClaimChip — passed in so the bar
     *  can highlight the caller's own active claim without a separate
     *  fetch. */
    claims?: EntityClaim[];
    /** Fires after any successful claim/release so MessageList can
     *  re-hydrate the bulk cache. Best-effort — no return value
     *  contract. */
    onClaimChanged?: () => void;
  };

  let { roomId, messageId, asHandle, claims = [], onClaimChanged }: Props = $props();

  // Existing active claims by the caller — controls which button reads
  // as "your active claim" vs "available action". Looking + working +
  // pass are all independently held.
  const myLooking = $derived(claims.find((c) => c.claim_kind === 'looking' && c.claimed_by_handle === asHandle) ?? null);
  const myWorking = $derived(claims.find((c) => c.claim_kind === 'working' && c.claimed_by_handle === asHandle) ?? null);
  const myPass    = $derived(claims.find((c) => c.claim_kind === 'pass'    && c.claimed_by_handle === asHandle) ?? null);

  const someoneElseWorking = $derived(
    claims.find((c) => c.claim_kind === 'working' && c.claimed_by_handle !== asHandle) ?? null
  );

  let busy = $state<ClaimKind | 'release' | null>(null);
  let errorMessage = $state('');
  let ttlPickerOpen = $state(false);

  // Focus-style TTL preset per JWPK msg_vl6uoynvsw — same picker we'd
  // use for focus mode. The brainstorm default highlight is 15m; the
  // heads-down default is 30m. ClaimChip carries the mode tint but
  // the picker stays identical — keeps the operator's mental model one.
  type TtlPreset = { label: string; ms: number | null };
  const TTL_PRESETS: TtlPreset[] = [
    { label: '15m', ms: 15 * 60_000 },
    { label: '30m', ms: 30 * 60_000 },
    { label: '45m', ms: 45 * 60_000 },
    { label: '1h', ms: 60 * 60_000 },
    { label: '2h', ms: 120 * 60_000 },
    { label: 'indefinite', ms: null }
  ];

  async function postClaim(kind: ClaimKind, ttlMs?: number | null): Promise<void> {
    busy = kind;
    errorMessage = '';
    try {
      const bodyShape: Record<string, unknown> = {
        entityKind: 'message',
        entityId: messageId,
        claimKind: kind,
        claimedByHandle: asHandle
      };
      if (kind === 'working' && ttlMs !== undefined) {
        bodyShape.ttlMs = ttlMs;
      }
      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/claims`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(bodyShape)
        }
      );
      if (!response.ok) {
        if (response.status === 409) {
          const failure = await response.json().catch(() => ({ message: response.statusText }));
          errorMessage = failure.message ?? 'Someone else already claimed this.';
        } else {
          const failure = await response.json().catch(() => ({ message: response.statusText }));
          errorMessage = failure.message ?? `Claim failed (${response.status}).`;
        }
        return;
      }
      onClaimChanged?.();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Claim failed.';
    } finally {
      busy = null;
    }
  }

  async function releaseClaim(claimId: string): Promise<void> {
    busy = 'release';
    errorMessage = '';
    try {
      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/claims`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ claimId, status: 'released' })
        }
      );
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        errorMessage = failure.message ?? 'Release failed.';
        return;
      }
      onClaimChanged?.();
    } catch (cause) {
      errorMessage = cause instanceof Error ? cause.message : 'Release failed.';
    } finally {
      busy = null;
    }
  }

  function handleLookingClick(): void {
    if (busy !== null) return;
    if (myLooking) {
      void releaseClaim(myLooking.id);
    } else {
      void postClaim('looking');
    }
  }

  function handleWorkingClick(): void {
    if (busy !== null) return;
    if (myWorking) {
      void releaseClaim(myWorking.id);
    } else if (someoneElseWorking) {
      errorMessage = `Already claimed by ${someoneElseWorking.claimed_by_handle}.`;
    } else {
      ttlPickerOpen = true;
    }
  }

  function handlePassClick(): void {
    if (busy !== null) return;
    if (myPass) {
      void releaseClaim(myPass.id);
    } else {
      void postClaim('pass');
    }
  }

  async function pickTtl(preset: TtlPreset): Promise<void> {
    ttlPickerOpen = false;
    await postClaim('working', preset.ms);
  }
</script>

<div class="claim-action-bar" role="toolbar" aria-label="Claim this message">
  <button
    type="button"
    class="claim-btn claim-btn-looking"
    class:active={myLooking !== null}
    onclick={handleLookingClick}
    disabled={busy !== null}
    title={myLooking ? 'You are reading — click to release' : "I'm reading this (90s)"}
  >
    <span aria-hidden="true">🖐️</span>
    <span class="claim-btn-label">{myLooking ? 'reading' : 'read'}</span>
  </button>

  <div class="claim-btn-group">
    <button
      type="button"
      class="claim-btn claim-btn-working"
      class:active={myWorking !== null}
      class:blocked={someoneElseWorking !== null && myWorking === null}
      onclick={handleWorkingClick}
      disabled={busy !== null}
      title={
        myWorking
          ? 'You are taking this — click to release'
          : someoneElseWorking
            ? `Already claimed by ${someoneElseWorking.claimed_by_handle}`
            : "I'm taking this — pick TTL"
      }
    >
      <span aria-hidden="true">🤝</span>
      <span class="claim-btn-label">{myWorking ? 'taking' : 'take'}</span>
    </button>
    {#if ttlPickerOpen}
      <div class="ttl-picker" role="menu" aria-label="Choose claim duration">
        {#each TTL_PRESETS as preset (preset.label)}
          <button
            type="button"
            class="ttl-option"
            onclick={() => void pickTtl(preset)}
          >{preset.label}</button>
        {/each}
        <button
          type="button"
          class="ttl-option ttl-cancel"
          onclick={() => (ttlPickerOpen = false)}
        >cancel</button>
      </div>
    {/if}
  </div>

  <button
    type="button"
    class="claim-btn claim-btn-pass"
    class:active={myPass !== null}
    onclick={handlePassClick}
    disabled={busy !== null}
    title={myPass ? 'You passed — click to re-engage' : "I pass on this"}
  >
    <span aria-hidden="true">👐</span>
    <span class="claim-btn-label">{myPass ? 'passed' : 'pass'}</span>
  </button>

  {#if errorMessage}
    <p class="claim-error" role="alert">{errorMessage}</p>
  {/if}
</div>

<style>
  .claim-action-bar {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    margin-right: 0.4rem;
    position: relative;
  }
  .claim-btn-group {
    position: relative;
  }
  .claim-btn {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.15rem 0.55rem;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-soft);
    font-size: 0.7rem;
    font-weight: 600;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    cursor: pointer;
    transition: border-color 0.12s, background 0.12s, color 0.12s;
  }
  .claim-btn:hover:not(:disabled) {
    border-color: var(--ink-strong);
    color: var(--ink-strong);
  }
  .claim-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .claim-btn.active {
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-card));
    border-color: var(--accent);
    color: var(--accent);
  }
  .claim-btn-working.blocked {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .claim-btn-working.active {
    background: color-mix(in srgb, #b45309 14%, var(--surface-card));
    border-color: #b45309;
    color: #92400e;
  }
  .claim-btn-pass.active {
    background: color-mix(in srgb, var(--ink-soft) 12%, var(--surface-card));
    border-color: var(--ink-soft);
    color: var(--ink-strong);
  }

  .ttl-picker {
    position: absolute;
    bottom: calc(100% + 0.35rem);
    right: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    padding: 0.45rem 0.55rem;
    background: var(--surface-card);
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    box-shadow: 0 12px 32px rgba(20, 18, 14, 0.15);
    z-index: 30;
    min-width: 16rem;
  }
  .ttl-option {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.72rem;
    font-weight: 700;
    cursor: pointer;
  }
  .ttl-option:hover { border-color: var(--accent); color: var(--accent); }
  .ttl-option.ttl-cancel {
    background: transparent;
    color: var(--ink-soft);
    font-weight: 600;
  }

  .claim-error {
    margin: 0 0 0 0.45rem;
    color: var(--accent);
    font-size: 0.7rem;
    line-height: 1.3;
  }
</style>
