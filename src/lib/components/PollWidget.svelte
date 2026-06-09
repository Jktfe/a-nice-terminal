<!--
  PollWidget — a live, inline poll rendered in the message stream.

  A vote-create receipt (and any message) embeds an `ant-poll` fence
  carrying a voteId; MessageRow extracts it (pollRefs.ts) and mounts this
  per id. JWPK msg_7nqg8oaufo: "renders in the chatrooms a bit like the
  table rendering; I want to see how many votes and who". So this surfaces
  the tally AND the voters under each option (from VoteView.ballots, which
  already carries voterHandle/optionId), with in-place casting for the
  logged-in viewer.

  SSR-safe: an optional `initialVote` renders server-side and in tests;
  the live copy is fetched onMount (the room-scoped GET /api/votes/:id).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { VoteView } from '$lib/server/voteStore';

  type Props = {
    voteId: string;
    roomId: string;
    /** Viewer's handle — drives the "you voted" marker. */
    asHandle?: string;
    /** SSR/test seed; live data replaces it onMount. */
    initialVote?: VoteView | null;
  };

  let { voteId, roomId, asHandle, initialVote = null }: Props = $props();

  let liveVote = $state<VoteView | null>(null);
  const vote = $derived(liveVote ?? initialVote);
  let isLoading = $state(false);
  let errorText = $state('');
  let castingOptionId = $state<string | null>(null);

  onMount(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    if (!voteId || !roomId) return;
    isLoading = true;
    errorText = '';
    try {
      const response = await fetch(
        `/api/votes/${encodeURIComponent(voteId)}?roomId=${encodeURIComponent(roomId)}`
      );
      if (response.status === 401 || response.status === 403 || response.status === 404) {
        // No read access / not found — fall back to whatever SSR gave us.
        return;
      }
      if (!response.ok) throw new Error(`Could not load poll (${response.status}).`);
      const body = (await response.json()) as { vote?: VoteView };
      if (body.vote) liveVote = body.vote;
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not load poll.';
    } finally {
      isLoading = false;
    }
  }

  async function cast(optionId: string): Promise<void> {
    if (!vote || vote.state === 'closed') return;
    castingOptionId = optionId;
    errorText = '';
    try {
      const response = await fetch(`/api/votes/${encodeURIComponent(voteId)}/cast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, optionId, asHandle })
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        const message =
          detail && typeof detail.message === 'string'
            ? detail.message
            : `Could not cast (${response.status}).`;
        throw new Error(message);
      }
      const body = (await response.json()) as { vote?: VoteView };
      if (body.vote) liveVote = body.vote;
      else await refresh();
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not cast vote.';
    } finally {
      castingOptionId = null;
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

  // option-id → handles that chose it (latest ballot per voter, from the view).
  const votersByOption = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const ballot of vote?.ballots ?? []) {
      const list = map.get(ballot.optionId) ?? [];
      list.push(ballot.voterHandle);
      map.set(ballot.optionId, list);
    }
    return map;
  });

  const totalBallots = $derived(vote?.ballots.length ?? 0);
  const eligibleCount = $derived(vote?.eligibleVoters.length ?? 0);

  function tallyFor(optionId: string): number {
    return vote?.tally.find((row) => row.optionId === optionId)?.count ?? 0;
  }

  // Bar width as a share of the electorate, so the bars read as turnout.
  function barPct(optionId: string): number {
    if (eligibleCount <= 0) return 0;
    return Math.min(100, Math.round((tallyFor(optionId) / eligibleCount) * 100));
  }

  function votersFor(optionId: string): string[] {
    return votersByOption.get(optionId) ?? [];
  }

  const viewerVotedOptionId = $derived.by(() => {
    if (!asHandle) return null;
    return vote?.ballots.find((b) => b.voterHandle === asHandle)?.optionId ?? null;
  });
</script>

{#if vote}
  <section class="poll" data-state={vote.state} aria-label={`Poll: ${vote.title}`}>
    <header class="poll-header">
      <div class="poll-title-wrap">
        <span class="poll-icon" aria-hidden="true">🗳️</span>
        <h4 class="poll-title">{vote.title}</h4>
      </div>
      <span class="poll-state" data-state={vote.state}>{stateLabel(vote.state)}</span>
    </header>

    {#if vote.body}
      <p class="poll-body">{vote.body}</p>
    {/if}

    <div class="poll-options">
      {#each vote.options as option (option.id)}
        {@const count = tallyFor(option.id)}
        {@const voters = votersFor(option.id)}
        {@const mine = viewerVotedOptionId === option.id}
        <div class="poll-option" class:is-mine={mine}>
          <div class="poll-option-bar" style:--bar-pct={`${barPct(option.id)}%`}>
            <div class="poll-option-fill"></div>
            <div class="poll-option-line">
              <span class="poll-option-label">
                {option.label}
                {#if mine}<span class="poll-you" title="You voted for this">✓ you</span>{/if}
              </span>
              <span class="poll-option-count">{count} {voteWord(count)}</span>
            </div>
          </div>
          <div class="poll-option-meta">
            {#if voters.length > 0}
              <span class="poll-voters">
                {#each voters as handle (handle)}<span class="poll-voter-chip">{handle}</span>{/each}
              </span>
            {:else}
              <span class="poll-noone">no votes yet</span>
            {/if}
            {#if vote.state !== 'closed'}
              <button
                type="button"
                class="poll-cast"
                onclick={() => cast(option.id)}
                disabled={castingOptionId !== null}
              >
                {castingOptionId === option.id ? 'Casting…' : mine ? 'Keep' : 'Vote'}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <footer class="poll-footer">
      <span>{totalBallots} of {eligibleCount} voted</span>
      {#if vote.missingVoters.length > 0}
        <span class="poll-missing" title={vote.missingVoters.join(', ')}>
          {vote.missingVoters.length} missing
        </span>
      {/if}
      <button type="button" class="poll-refresh" onclick={refresh} disabled={isLoading}>
        {isLoading ? '…' : 'Refresh'}
      </button>
    </footer>

    {#if errorText}
      <p class="poll-error" role="alert">{errorText}</p>
      <code class="poll-cli">ant vote cast {vote.id} --room {roomId} --option &lt;optionId&gt;</code>
    {/if}
  </section>
{/if}

<style>
  .poll {
    margin: 0.55rem 0 0.2rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-raised);
    max-width: 30rem;
  }

  .poll[data-state='complete'] {
    border-color: color-mix(in srgb, #16a34a 42%, var(--line-soft));
  }

  .poll[data-state='closed'] {
    opacity: 0.85;
  }

  .poll-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .poll-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }

  .poll-icon {
    font-size: 0.95rem;
  }

  .poll-title {
    margin: 0;
    color: var(--ink-strong);
    font-size: 0.92rem;
    font-weight: 850;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }

  .poll-state {
    flex: 0 0 auto;
    padding: 0.18rem 0.45rem;
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.68rem;
    font-weight: 850;
  }

  .poll-state[data-state='open'] {
    background: color-mix(in srgb, #2563eb 11%, var(--surface-raised));
    color: #1d4ed8;
  }

  .poll-state[data-state='complete'] {
    background: color-mix(in srgb, #16a34a 12%, var(--surface-raised));
    color: #15803d;
  }

  .poll-body {
    margin: 0.45rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.4;
  }

  .poll-options {
    display: grid;
    gap: 0.45rem;
    margin-top: 0.65rem;
  }

  .poll-option-bar {
    position: relative;
    border-radius: 0.45rem;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    overflow: hidden;
  }

  .poll-option-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--bar-pct, 0%);
    background: color-mix(in srgb, #2563eb 16%, transparent);
    transition: width 0.25s ease;
  }

  .poll-option.is-mine .poll-option-fill {
    background: color-mix(in srgb, #16a34a 20%, transparent);
  }

  .poll-option-line {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.42rem 0.55rem;
  }

  .poll-option-label {
    color: var(--ink-strong);
    font-size: 0.82rem;
    font-weight: 800;
    overflow-wrap: anywhere;
  }

  .poll-you {
    margin-left: 0.35rem;
    color: #15803d;
    font-size: 0.7rem;
    font-weight: 850;
  }

  .poll-option-count {
    flex: 0 0 auto;
    color: var(--ink-soft);
    font-size: 0.76rem;
    font-weight: 750;
  }

  .poll-option-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.3rem 0.15rem 0.05rem;
  }

  .poll-voters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.22rem;
  }

  .poll-voter-chip {
    padding: 0.06rem 0.36rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink-strong) 7%, var(--surface-raised));
    color: var(--ink-strong);
    font-size: 0.7rem;
    font-weight: 700;
  }

  .poll-noone {
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-style: italic;
  }

  .poll-cast {
    flex: 0 0 auto;
    min-height: 1.6rem;
    padding: 0.2rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-size: 0.74rem;
    font-weight: 800;
    cursor: pointer;
  }

  .poll-cast:disabled {
    opacity: 0.55;
    cursor: default;
  }

  .poll-footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.6rem;
    color: var(--ink-soft);
    font-size: 0.74rem;
    font-weight: 700;
  }

  .poll-missing {
    color: color-mix(in srgb, #b91c1c 75%, var(--ink-soft));
  }

  .poll-refresh {
    margin-left: auto;
    min-height: 1.5rem;
    padding: 0.16rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-size: 0.72rem;
    font-weight: 800;
  }

  .poll-error {
    margin: 0.5rem 0 0.2rem;
    color: var(--danger, #b91c1c);
    font-size: 0.78rem;
  }

  .poll-cli {
    display: inline-block;
    overflow-wrap: anywhere;
    padding: 0.16rem 0.3rem;
    border-radius: 0.35rem;
    background: color-mix(in srgb, var(--ink-strong) 6%, var(--surface-card, white));
    color: var(--ink-strong);
    font-size: 0.7rem;
  }

  @media (max-width: 720px) {
    .poll {
      max-width: 100%;
    }
    .poll-option-meta {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
