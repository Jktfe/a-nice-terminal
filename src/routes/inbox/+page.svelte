<!--
  /inbox — the global held-ask + owner-notification surface.

  JWPK taste rulings (ANT sorted, 2026-06-10): notifications are INBOX
  items, not room noise; an open ask is visible here globally AND in its
  origin room; approval is TYPEABLE IN CHAT — so each card leads with the
  exact approve line and a copy button, plus a deep link to the origin
  room where typing it lands. The page surfaces; the chat actuates —
  approval rides the post path's witnessed identity and is ledgered like
  every other binding change.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { HeldAskView, OwnerNotificationView } from './+page';

  type Props = {
    data: {
      heldAsks: HeldAskView[];
      ownerNotifications: OwnerNotificationView[];
      fetchFailed: boolean;
      unauthorised: boolean;
    };
  };

  let { data }: Props = $props();

  const heldAsks = $derived<HeldAskView[]>(data.heldAsks);
  const ownerNotifications = $derived<OwnerNotificationView[]>(data.ownerNotifications);
  const fetchFailed = $derived<boolean>(data.fetchFailed);
  const unauthorised = $derived<boolean>(data.unauthorised);

  let copiedRequestId = $state<string | null>(null);

  async function copyApprove(ask: HeldAskView): Promise<void> {
    try {
      await navigator.clipboard.writeText(ask.approveCommand);
      copiedRequestId = ask.requestId;
      setTimeout(() => { copiedRequestId = null; }, 1500);
    } catch {
      /* clipboard denied — the command is visible to select manually */
    }
  }

  function whenLabel(atMs: number): string {
    const deltaMin = Math.max(0, Math.round((Date.now() - atMs) / 60_000));
    if (deltaMin < 1) return 'just now';
    if (deltaMin < 60) return `${deltaMin}m ago`;
    const hours = Math.floor(deltaMin / 60);
    return `${hours}h ${deltaMin % 60}m ago`;
  }

  // Held asks churn as approvals land in chat — poll gently while open.
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  onMount(() => {
    pollTimer = setInterval(() => { void invalidateAll(); }, 5000);
  });
  onDestroy(() => {
    if (pollTimer !== null) clearInterval(pollTimer);
  });
</script>

<SimplePageShell title="Inbox">
  {#if unauthorised}
    <p class="empty">Sign in to see your inbox.</p>
  {:else if fetchFailed}
    <p class="empty">Inbox could not load — retrying automatically.</p>
  {:else}
    <section aria-label="Held asks">
      <h2>Held asks <span class="count">{heldAsks.length}</span></h2>
      {#if heldAsks.length === 0}
        <p class="empty">Nothing waiting on you. Approvals land here when an action holds for an owner.</p>
      {:else}
        <ul class="cards">
          {#each heldAsks as ask (ask.requestId)}
            <li class="card">
              <div class="card-head">
                <span class="requester">{ask.requesterHandle}</span>
                <span class="wants">wants</span>
                <code class="action">{ask.action}</code>
                <span class="wants">on</span>
                <code class="target">{ask.targetKind} {ask.targetId}</code>
                <span class="when">{whenLabel(ask.createdAtMs)}</span>
              </div>
              <div class="approve-row">
                <code class="approve-line">{ask.approveCommand}</code>
                <button type="button" onclick={() => copyApprove(ask)}>
                  {copiedRequestId === ask.requestId ? 'Copied' : 'Copy'}
                </button>
                {#if ask.targetKind === 'room'}
                  <a class="room-link" href={`/rooms/${ask.targetId}`}>type it in the room →</a>
                {/if}
              </div>
              {#if ask.approvers.length > 0}
                <p class="approvers">
                  approvers:
                  {#each ask.approvers as approver, index}
                    <span class:preferred={approver.preferred}>{approver.handle}</span>{index < ask.approvers.length - 1 ? ', ' : ''}
                  {/each}
                </p>
              {/if}
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <section aria-label="Owner notifications">
      <h2>Owner notifications <span class="count">{ownerNotifications.length}</span></h2>
      {#if ownerNotifications.length === 0}
        <p class="empty">No claims on your desks. Vacant-handle reclaims and binding changes appear here.</p>
      {:else}
        <ul class="cards">
          {#each ownerNotifications as note (note.atMs + (note.handle ?? ''))}
            <li class="card notification">
              <div class="card-head">
                <code class="target">{note.handle ?? 'unknown handle'}</code>
                <span class="wants">{note.reason ?? 'binding change'}</span>
                {#if note.pane}<code class="action">{note.pane}</code>{/if}
                <span class="when">{whenLabel(note.atMs)}</span>
              </div>
              <p class="approvers">notified: {note.owners.join(', ')}</p>
            </li>
          {/each}
        </ul>
      {/if}
    </section>
  {/if}
</SimplePageShell>

<style>
  h2 {
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    opacity: 0.85;
    margin: 1.4rem 0 0.6rem;
  }
  .count {
    opacity: 0.6;
    font-weight: normal;
    margin-left: 0.35rem;
  }
  .cards {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .card {
    border: 1px solid color-mix(in srgb, currentColor 18%, transparent);
    border-radius: 8px;
    padding: 0.7rem 0.9rem;
  }
  .card.notification {
    opacity: 0.92;
  }
  .card-head {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    flex-wrap: wrap;
  }
  .requester {
    font-weight: 600;
  }
  .wants {
    opacity: 0.6;
    font-size: 0.85rem;
  }
  .when {
    margin-left: auto;
    opacity: 0.5;
    font-size: 0.8rem;
  }
  code {
    font-size: 0.85rem;
    padding: 0.05rem 0.35rem;
    border-radius: 4px;
    background: color-mix(in srgb, currentColor 10%, transparent);
  }
  .approve-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-top: 0.55rem;
  }
  .approve-line {
    font-weight: 600;
  }
  .approve-row button {
    font-size: 0.78rem;
    padding: 0.15rem 0.6rem;
    border-radius: 5px;
    border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
    background: transparent;
    color: inherit;
    cursor: pointer;
  }
  .room-link {
    font-size: 0.8rem;
    opacity: 0.75;
  }
  .approvers {
    margin: 0.5rem 0 0;
    font-size: 0.8rem;
    opacity: 0.65;
  }
  .approvers .preferred {
    font-weight: 600;
    opacity: 1;
  }
  .empty {
    opacity: 0.55;
    font-size: 0.9rem;
  }
</style>
