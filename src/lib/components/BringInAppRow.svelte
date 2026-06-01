<!--
  BringInAppRow — premium one-tap launchers for external apps, web v0.

  Closes a-nice-terminal cross-repo audit gap #6b. Server contract shipped
  at c80f351; this component is the operator-facing UI on the web.

  v0 ships ONE active adapter (Claude Desktop, Anthropic-first per spec).
  Other targets render disabled with "v0.5" tooltip until adapters land.
  Premium-tier-gated via `bring_in_app_ux` feature flag: when NOT available the
  row renders nothing. The old "Bring in Claude / ChatGPT … Premium" teaser was
  removed from web (JWPK 2026-06-01 — it did nothing here); bring-in-agent
  belongs in the antOS / remote-ant apps, where it is a real action.

  Lives below the room header so the affordance is reachable when the
  operator wants to hand off the room context to an external thinker.
-->
<script lang="ts">
  import { BRING_IN_APP_ADAPTERS, type ClientAdapter, type LaunchOutcome } from '$lib/bringInApp/adapters';
  import type { BringInAppResponse, BringInTarget } from '$lib/bringInApp/types';

  type Props = {
    roomId: string;
    /** When false, the whole row renders as a single "Upgrade for one-tap
     *  launchers" affordance. Drive from `bring_in_app_ux` feature flag. */
    available: boolean;
  };

  let { roomId, available }: Props = $props();

  let launchingTarget = $state<BringInTarget | null>(null);
  let lastOutcome = $state<LaunchOutcome | null>(null);
  let lastError = $state<string | null>(null);

  async function bringIn(adapter: ClientAdapter) {
    if (!adapter.available) return;
    launchingTarget = adapter.target;
    lastOutcome = null;
    lastError = null;
    try {
      // Step 1: server mints the payload + records the audit row.
      const response = await fetch(`/api/chat-rooms/${roomId}/bring-in-app`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ target: adapter.target })
      });
      if (!response.ok) {
        const errBody = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(errBody.message ?? `HTTP ${response.status}`);
      }
      const data = (await response.json()) as BringInAppResponse;

      // Step 2: client adapter dispatches the launch.
      const outcome = await adapter.launch(data.payload);
      lastOutcome = outcome;
    } catch (cause) {
      lastError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      launchingTarget = null;
    }
  }
</script>

{#if available}
  <div class="bring-in-row" role="toolbar" aria-label="Bring in an external app with this room's context">
    {#each BRING_IN_APP_ADAPTERS as adapter}
      <button
        type="button"
        class="bring-in-pill"
        class:disabled={!adapter.available}
        class:in-flight={launchingTarget === adapter.target}
        disabled={!adapter.available || launchingTarget !== null}
        title={adapter.unavailableReason ?? `Open ${adapter.label.replace('Bring in ', '')} with this room's context`}
        onclick={() => bringIn(adapter)}
      >
        {adapter.label}
      </button>
    {/each}
  </div>
  {#if lastOutcome}
    <p class="outcome outcome-{lastOutcome.status}" role="status">{lastOutcome.message}</p>
  {/if}
  {#if lastError}
    <p class="outcome outcome-error" role="alert">{lastError}</p>
  {/if}
{/if}

<style>
  .bring-in-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-top: 0.4rem;
    padding: 0.35rem 0;
  }
  .bring-in-pill {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line-soft, #ead8ca);
    border-radius: 999px;
    background: var(--surface-card, #ffffff);
    color: var(--ink-strong, #181512);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
  }
  .bring-in-pill:hover:not(:disabled) {
    border-color: var(--accent, #ff3d5a);
    color: var(--accent, #ff3d5a);
  }
  .bring-in-pill.disabled,
  .bring-in-pill:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }
  .bring-in-pill.in-flight {
    border-color: var(--accent, #ff3d5a);
    color: var(--accent, #ff3d5a);
  }
  .outcome {
    margin: 0.35rem 0 0;
    font-size: 0.78rem;
    line-height: 1.3;
  }
  .outcome-launched { color: var(--ok, #1ac270); }
  .outcome-fallback { color: var(--warn, #ffb100); }
  .outcome-unavailable,
  .outcome-error { color: var(--accent, #ff3d5a); }
</style>
