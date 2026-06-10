<!--
  StatusBoard — a live milestone tracker rendered inline in the message
  stream (JWPK msg_39mnm7blal: `/status-poll [complete/in progress/stuck/
  blocked] "title" --agents [@..]`).

  It's the poll generalised: a poll is "pick one option (a decision)", a
  status board is "report your state (progress)". Same data shape, so it
  reads the SAME `/api/votes/:id` a PollWidget does — the board is a vote
  whose options are the status states and whose participants are the agents.
  MessageRow mounts this for an `ant-status` fence (statusRefs) instead of a
  PollWidget for `ant-poll`. Relabelled for status semantics: a row per
  state with the agents sitting in it, "reported" not "voted", "pending"
  not "missing", "this is me" not "vote".

  SSR-safe: an optional `initialBoard` renders server-side and in tests; the
  live copy is fetched onMount.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { VoteView } from '$lib/server/voteStore';

  type Props = {
    boardId: string;
    roomId: string;
    /** Viewer's handle — drives the "this is me" marker + set-status. */
    asHandle?: string;
    /** SSR/test seed; live data replaces it onMount. */
    initialBoard?: VoteView | null;
  };

  let { boardId, roomId, asHandle, initialBoard = null }: Props = $props();

  let liveBoard = $state<VoteView | null>(null);
  const board = $derived(liveBoard ?? initialBoard);
  let isLoading = $state(false);
  let errorText = $state('');
  let settingStateId = $state<string | null>(null);

  onMount(() => {
    void refresh();
  });

  async function refresh(): Promise<void> {
    if (!boardId || !roomId) return;
    isLoading = true;
    errorText = '';
    try {
      const response = await fetch(
        `/api/votes/${encodeURIComponent(boardId)}?roomId=${encodeURIComponent(roomId)}`
      );
      if (response.status === 401 || response.status === 403 || response.status === 404) return;
      if (!response.ok) throw new Error(`Could not load status board (${response.status}).`);
      const body = (await response.json()) as { vote?: VoteView };
      if (body.vote) liveBoard = body.vote;
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not load status board.';
    } finally {
      isLoading = false;
    }
  }

  async function setState(optionId: string): Promise<void> {
    if (!board || board.state === 'closed') return;
    settingStateId = optionId;
    errorText = '';
    try {
      const response = await fetch(`/api/votes/${encodeURIComponent(boardId)}/cast`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomId, optionId, asHandle })
      });
      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(
          detail && typeof detail.message === 'string'
            ? detail.message
            : `Could not set status (${response.status}).`
        );
      }
      const body = (await response.json()) as { vote?: VoteView };
      if (body.vote) liveBoard = body.vote;
      else await refresh();
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not set status.';
    } finally {
      settingStateId = null;
    }
  }

  function stateLabel(state: VoteView['state']): string {
    if (state === 'complete') return 'All reported';
    if (state === 'closed') return 'Closed';
    return 'Open';
  }

  // option-id (= a status state) → agents who are in that state.
  const agentsByState = $derived.by(() => {
    const map = new Map<string, string[]>();
    for (const ballot of board?.ballots ?? []) {
      const list = map.get(ballot.optionId) ?? [];
      list.push(ballot.voterHandle);
      map.set(ballot.optionId, list);
    }
    return map;
  });

  const reportedCount = $derived(board?.ballots.length ?? 0);
  const participantCount = $derived(board?.eligibleVoters.length ?? 0);

  function agentsIn(optionId: string): string[] {
    return agentsByState.get(optionId) ?? [];
  }

  function barPct(optionId: string): number {
    if (participantCount <= 0) return 0;
    return Math.min(100, Math.round((agentsIn(optionId).length / participantCount) * 100));
  }

  const myStateId = $derived.by(() => {
    if (!asHandle) return null;
    return board?.ballots.find((b) => b.voterHandle === asHandle)?.optionId ?? null;
  });
</script>

{#if board}
  <section class="board" data-state={board.state} aria-label={`Status board: ${board.title}`}>
    <header class="board-header">
      <div class="board-title-wrap">
        <span class="board-icon" aria-hidden="true">📍</span>
        <h4 class="board-title">{board.title}</h4>
      </div>
      <span class="board-state" data-state={board.state}>{stateLabel(board.state)}</span>
    </header>

    {#if board.body}
      <p class="board-body">{board.body}</p>
    {/if}

    <div class="board-states">
      {#each board.options as option (option.id)}
        {@const who = agentsIn(option.id)}
        {@const mine = myStateId === option.id}
        <div class="board-row" class:is-mine={mine}>
          <div class="board-bar" style:--bar-pct={`${barPct(option.id)}%`}>
            <div class="board-fill"></div>
            <div class="board-line">
              <span class="board-label">{option.label}</span>
              <span class="board-count">{who.length}</span>
            </div>
          </div>
          <div class="board-meta">
            {#if who.length > 0}
              <span class="board-agents">
                {#each who as handle (handle)}
                  <span class="board-chip" class:is-me={handle === asHandle}>{handle}</span>
                {/each}
              </span>
            {:else}
              <span class="board-none">—</span>
            {/if}
            {#if board.state !== 'closed'}
              <button
                type="button"
                class="board-set"
                onclick={() => setState(option.id)}
                disabled={settingStateId !== null}
              >
                {settingStateId === option.id ? 'Setting…' : mine ? '✓ me' : 'this is me'}
              </button>
            {/if}
          </div>
        </div>
      {/each}
    </div>

    <footer class="board-footer">
      <span>{reportedCount} of {participantCount} reported</span>
      {#if board.missingVoters.length > 0}
        <span class="board-pending" title={board.missingVoters.join(', ')}>
          {board.missingVoters.length} pending
        </span>
      {/if}
      <button type="button" class="board-refresh" onclick={refresh} disabled={isLoading}>
        {isLoading ? '…' : 'Refresh'}
      </button>
    </footer>

    {#if errorText}
      <p class="board-error" role="alert">{errorText}</p>
    {/if}
  </section>
{/if}

<style>
  .board {
    margin: 0.55rem 0 0.2rem;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-raised);
    max-width: 30rem;
  }
  .board[data-state='complete'] {
    border-color: color-mix(in srgb, #16a34a 42%, var(--line-soft));
  }
  .board[data-state='closed'] {
    opacity: 0.85;
  }
  .board-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .board-title-wrap {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    min-width: 0;
  }
  .board-icon {
    font-size: 0.95rem;
  }
  .board-title {
    margin: 0;
    color: var(--ink-strong);
    font-size: 0.92rem;
    font-weight: 850;
    line-height: 1.2;
    overflow-wrap: anywhere;
  }
  .board-state {
    flex: 0 0 auto;
    padding: 0.18rem 0.45rem;
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.68rem;
    font-weight: 850;
  }
  .board-state[data-state='open'] {
    background: color-mix(in srgb, #2563eb 11%, var(--surface-raised));
    color: #1d4ed8;
  }
  .board-state[data-state='complete'] {
    background: color-mix(in srgb, #16a34a 12%, var(--surface-raised));
    color: #15803d;
  }
  .board-body {
    margin: 0.45rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.4;
  }
  .board-states {
    display: grid;
    gap: 0.45rem;
    margin-top: 0.65rem;
  }
  .board-bar {
    position: relative;
    border-radius: 0.45rem;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    overflow: hidden;
  }
  .board-fill {
    position: absolute;
    inset: 0 auto 0 0;
    width: var(--bar-pct, 0%);
    background: color-mix(in srgb, #2563eb 16%, transparent);
    transition: width 0.25s ease;
  }
  .board-row.is-mine .board-fill {
    background: color-mix(in srgb, #16a34a 20%, transparent);
  }
  .board-line {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.6rem;
    padding: 0.42rem 0.55rem;
  }
  .board-label {
    color: var(--ink-strong);
    font-size: 0.82rem;
    font-weight: 800;
    overflow-wrap: anywhere;
  }
  .board-count {
    flex: 0 0 auto;
    color: var(--ink-soft);
    font-size: 0.78rem;
    font-weight: 800;
  }
  .board-meta {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.3rem 0.15rem 0.05rem;
  }
  .board-agents {
    display: flex;
    flex-wrap: wrap;
    gap: 0.22rem;
  }
  .board-chip {
    padding: 0.06rem 0.36rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink-strong) 7%, var(--surface-raised));
    color: var(--ink-strong);
    font-size: 0.7rem;
    font-weight: 700;
  }
  .board-chip.is-me {
    background: color-mix(in srgb, #16a34a 18%, var(--surface-raised));
    color: #15803d;
  }
  .board-none {
    color: var(--ink-soft);
    font-size: 0.72rem;
  }
  .board-set {
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
  .board-set:disabled {
    opacity: 0.55;
    cursor: default;
  }
  .board-footer {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-top: 0.6rem;
    color: var(--ink-soft);
    font-size: 0.74rem;
    font-weight: 700;
  }
  .board-pending {
    color: color-mix(in srgb, #b45309 80%, var(--ink-soft));
  }
  .board-refresh {
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
  .board-error {
    margin: 0.5rem 0 0.2rem;
    color: var(--danger, #b91c1c);
    font-size: 0.78rem;
  }
  @media (max-width: 720px) {
    .board {
      max-width: 100%;
    }
    .board-meta {
      align-items: flex-start;
      flex-direction: column;
    }
  }
</style>
