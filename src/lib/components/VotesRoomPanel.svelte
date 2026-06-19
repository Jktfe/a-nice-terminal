<!--
  VotesRoomPanel — room-visible surface for the durable `ant vote` primitive.

  The first UI slice is intentionally read-mostly: it makes vote state visible
  in the room and gives exact CLI commands for cast/close. Browser-side
  ballot controls can land once the product decides who may cast as whom.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { VoteView } from '$lib/server/voteStore';

  type Props = {
    roomId: string;
    initialVotes?: VoteView[];
  };

  let { roomId, initialVotes = [] }: Props = $props();

  let liveVotes = $state<VoteView[] | null>(null);
  const visibleVotes = $derived(liveVotes ?? initialVotes);
  let isLoading = $state(false);
  let errorText = $state('');

  onMount(() => {
    void refreshVotes();
  });

  async function refreshVotes(): Promise<void> {
    if (!roomId) {
      isLoading = false;
      return;
    }
    isLoading = true;
    errorText = '';
    try {
      const response = await fetch(`/api/votes?roomId=${encodeURIComponent(roomId)}`);
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        throw new Error('Could not load votes for this room. Try refreshing in a moment.');
      }
      if (!response.ok) throw new Error(`Could not load votes (${response.status}).`);
      const body = (await response.json()) as { votes?: VoteView[] };
      liveVotes = body.votes ?? [];
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not load votes.';
    } finally {
      isLoading = false;
    }
  }

  function stateLabel(state: VoteView['state']): string {
    if (state === 'complete') return 'Complete';
    if (state === 'closed') return 'Closed';
    return 'Open';
  }

  function voteWord(count: number): string {
    return count === 1 ? 'vote' : 'votes';
  }

  function missingLabel(vote: VoteView): string {
    return vote.missingVoters.length > 0 ? vote.missingVoters.join(', ') : 'none';
  }

  function createCommand(): string {
    return `ant vote create --room ${roomId} --title "..." --options yes,no`;
  }

  function castCommand(vote: VoteView, optionId: string): string {
    return `ant vote cast ${vote.id} --room ${roomId} --option ${optionId}`;
  }

  function closeCommand(vote: VoteView): string {
    return `ant vote close ${vote.id} --room ${roomId}`;
  }
</script>

<section class="votes-panel" aria-labelledby="votes-panel-heading">
  <header class="votes-header">
    <div>
      <h2 id="votes-panel-heading">Votes</h2>
      <p>Room and cross-room decisions with a durable tally.</p>
    </div>
    <button type="button" class="refresh-button" onclick={refreshVotes} disabled={isLoading}>
      Refresh
    </button>
  </header>

  {#if errorText}
    <p class="vote-error" role="alert">{errorText}</p>
  {/if}

  {#if isLoading}
    <p class="vote-empty">Loading votes...</p>
  {:else if visibleVotes.length === 0}
    <div class="vote-empty-card">
      <p>No votes in this room yet.</p>
      <code>{createCommand()}</code>
    </div>
  {:else}
    <div class="vote-list">
      {#each visibleVotes as vote (vote.id)}
        <article class="vote-card" data-state={vote.state}>
          <header class="vote-card-header">
            <div>
              <p class="vote-kicker">{vote.roomIds.length} {vote.roomIds.length === 1 ? 'room' : 'rooms'} · {vote.eligibleVoters.length} voters</p>
              <h3>{vote.title}</h3>
            </div>
            <span class="state-chip" data-state={vote.state}>{stateLabel(vote.state)}</span>
          </header>

          {#if vote.body}
            <p class="vote-body">{vote.body}</p>
          {/if}

          <div class="tally-list" aria-label={`Tally for ${vote.title}`}>
            {#each vote.tally as row}
              <div class="tally-row">
                <span class="option-label">{row.label}</span>
                <span class="vote-count">{row.count} {voteWord(row.count)}</span>
                <code>{castCommand(vote, row.optionId)}</code>
              </div>
            {/each}
          </div>

          <footer class="vote-footer">
            <span>Missing: {missingLabel(vote)}</span>
            <code>{closeCommand(vote)}</code>
          </footer>
        </article>
      {/each}
    </div>
  {/if}
</section>

<style>
  .votes-panel {
    padding: 1rem 1.15rem;
  }

  .votes-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.75rem;
    margin-bottom: 0.85rem;
  }

  .votes-header h2 {
    margin: 0;
    color: var(--ink-strong);
    font-size: 1.05rem;
    font-weight: 850;
  }

  .votes-header p {
    margin: 0.25rem 0 0;
    color: var(--ink-soft);
    font-size: 0.83rem;
    line-height: 1.35;
  }

  .refresh-button {
    flex: 0 0 auto;
    min-height: 2rem;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-weight: 800;
  }

  .refresh-button:disabled {
    opacity: 0.55;
  }

  .vote-error,
  .vote-empty,
  .vote-empty-card {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
  }

  .vote-error {
    color: var(--danger, #b91c1c);
  }

  .vote-empty-card {
    display: grid;
    gap: 0.55rem;
    padding: 0.75rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.55rem;
    background: var(--surface-raised);
  }

  .vote-list {
    display: grid;
    gap: 0.7rem;
  }

  .vote-card {
    padding: 0.8rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-raised);
  }

  .vote-card[data-state='complete'] {
    border-color: color-mix(in srgb, #16a34a 42%, var(--line-soft));
  }

  .vote-card[data-state='closed'] {
    opacity: 0.82;
  }

  .vote-card-header,
  .vote-footer,
  .tally-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.7rem;
  }

  .vote-card-header h3 {
    margin: 0.1rem 0 0;
    color: var(--ink-strong);
    font-size: 0.98rem;
    line-height: 1.25;
  }

  .vote-kicker {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0;
  }

  .state-chip {
    flex: 0 0 auto;
    padding: 0.25rem 0.5rem;
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.72rem;
    font-weight: 850;
  }

  .state-chip[data-state='open'] {
    background: color-mix(in srgb, #2563eb 11%, var(--surface-raised));
    color: #1d4ed8;
  }

  .state-chip[data-state='complete'] {
    background: color-mix(in srgb, #16a34a 12%, var(--surface-raised));
    color: #15803d;
  }

  .vote-body {
    margin: 0.55rem 0 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
    line-height: 1.4;
  }

  .tally-list {
    display: grid;
    gap: 0.4rem;
    margin-top: 0.75rem;
  }

  .tally-row {
    padding: 0.5rem;
    border-radius: 0.5rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
  }

  .option-label,
  .vote-count,
  .vote-footer {
    font-size: 0.82rem;
  }

  .option-label {
    color: var(--ink-strong);
    font-weight: 850;
  }

  .vote-count,
  .vote-footer {
    color: var(--ink-soft);
    font-weight: 700;
  }

  code {
    max-width: 100%;
    overflow-wrap: anywhere;
    padding: 0.18rem 0.32rem;
    border-radius: 0.35rem;
    background: color-mix(in srgb, var(--ink-strong) 6%, var(--surface-card, white));
    color: var(--ink-strong);
    font-size: 0.72rem;
  }

  .vote-footer {
    margin-top: 0.65rem;
    align-items: flex-start;
  }

  @media (max-width: 720px) {
    .votes-header,
    .vote-card-header,
    .vote-footer,
    .tally-row {
      align-items: stretch;
      flex-direction: column;
    }

    .refresh-button {
      width: 100%;
    }
  }
</style>
