<!--
  /asks route — cross-room open asks queue.
  Backs asks UI slice 3 (paired with AskCard.svelte per the approved split).

  This page owns SSR-derived data + in-flight state + fetch handlers +
  invalidateAll + the labelled "Open asks queue" region. AskCard is a
  pure renderer it drives via callback props.

  Per @evolveantcodex contract:
    - SSR-first via $derived(data.x). No $state+$effect copy.
    - /api/asks failure and chair lookup are independent (loader).
    - List region aria-label="Open asks queue".
    - Answer + Dismiss disable while submitting, soft-fail inline,
      invalidateAll on success, resolved asks drop out of the queue.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import { onMount, onDestroy } from 'svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import AskCard from '$lib/components/AskCard.svelte';
  import {
    submitAnswerFor as askActionsAnswer,
    submitDismissFor as askActionsDismiss
  } from '$lib/askActions';
  import type { Ask } from '$lib/server/askStore';

  const ACTOR_HANDLE = '@you';

  type Props = {
    data: {
      asksFromServer: Ask[];
      recentlyAnsweredFromServer: Ask[];
      roomNameByRoomId: Record<string, string>;
      asksFetchFailed: boolean;
    };
  };

  let { data }: Props = $props();

  const asksFromServer = $derived<Ask[]>(data.asksFromServer);
  const recentlyAnsweredFromServer = $derived<Ask[]>(data.recentlyAnsweredFromServer);
  const roomNameByRoomId = $derived<Record<string, string>>(data.roomNameByRoomId);
  const asksFetchFailed = $derived<boolean>(data.asksFetchFailed);

  // Text filter (JWPK rooms-filter follow-up, 2026-05-24): mirrors the
  // /rooms name-or-description filter. With many cross-room asks, "find
  // the one about board prep" needs to work via keyboard, not visual
  // scan. Matches ask.title and the resolved room name case-insensitively
  // so "board" finds "Board Q4 prep" and any ask in a room called Boardroom.
  // Per-session state — no localStorage (the queue churns fast).
  let askFilter = $state('');
  let askFilterInputEl = $state<HTMLInputElement | undefined>();

  function matchesAskFilter(ask: Ask, needle: string): boolean {
    if (needle.length === 0) return true;
    if (ask.title.toLowerCase().includes(needle)) return true;
    const roomName = resolveRoomNameSafely(ask.roomId).toLowerCase();
    if (roomName.includes(needle)) return true;
    return false;
  }

  const filteredOpenAsks = $derived.by(() => {
    const needle = askFilter.trim().toLowerCase();
    if (needle.length === 0) return asksFromServer;
    return asksFromServer.filter((ask) => matchesAskFilter(ask, needle));
  });

  const filteredAnsweredAsks = $derived.by(() => {
    const needle = askFilter.trim().toLowerCase();
    if (needle.length === 0) return recentlyAnsweredFromServer;
    return recentlyAnsweredFromServer.filter((ask) => matchesAskFilter(ask, needle));
  });

  // Filter-aware empty-state branching (codex CHANGES REQUESTED on
  // 5aef74b): the prior shape only checked Open-section emptiness, so a
  // filter that matched neither Open nor Recently-answered fell through
  // to the celebratory "All caught up" state when Open started empty.
  // These derived flags drive a unified no-results state when filtering.
  const isFiltering = $derived(askFilter.trim().length > 0);
  const hasFilteredResults = $derived(filteredOpenAsks.length + filteredAnsweredAsks.length > 0);

  // One answer form open at a time; one in-flight verb at a time. Keeps
  // state shape tight and matches the "one task in focus" UX of a queue.
  let activeAnswerAskId = $state<string | null>(null);
  let answerText = $state('');
  let inFlightAskId = $state<string | null>(null);
  let inFlightVerb = $state<'answer' | 'dismiss' | null>(null);
  let lastErrorByAskId = $state<Record<string, string>>({});

  // Ask-pickup notice (task 3947e563, JWPK msg_kjyh3lmypd): per-card
  // pickup summary loaded best-effort after hydration. The data drives
  // a small footer line on each Recently-answered card so JWPK can see
  // 'N messages since answer · M agents acted' without leaving /asks.
  type PickupSummary = {
    messagesAfterAnswer: number;
    distinctAgentsAfterAnswer: number;
    agentsAfterAnswer: string[];
    firstMessageAfterAnswer: {
      messageId: string;
      authorHandle: string;
      authorDisplayName: string;
      postedAt: string;
      bodyPreview: string;
    } | null;
  };
  let pickupByAskId = $state<Record<string, PickupSummary>>({});

  async function loadPickupForAsk(askId: string): Promise<void> {
    try {
      const response = await fetch(`/api/asks/${encodeURIComponent(askId)}/pickup`);
      if (!response.ok) return;
      const body = (await response.json()) as { pickup?: PickupSummary };
      if (body.pickup) pickupByAskId = { ...pickupByAskId, [askId]: body.pickup };
    } catch { /* best-effort, leave row without summary */ }
  }

  $effect(() => {
    // Fire on every recently-answered list refresh — invalidateAll after
    // answer/dismiss will re-trigger this.
    for (const ask of recentlyAnsweredFromServer) {
      if (!pickupByAskId[ask.id]) void loadPickupForAsk(ask.id);
    }
  });

  // "/" keyboard shortcut focuses the filter input (mirrors /rooms d08bc69
  // /e059268). Same defensive shape: skips when typing into another input/
  // textarea/select/contentEditable or with any modifier held.
  onMount(() => {
    window.addEventListener('keydown', handleGlobalKeydown);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', handleGlobalKeydown);
    }
  });

  function handleGlobalKeydown(event: KeyboardEvent): void {
    if (event.key !== '/') return;
    if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const target = event.target as HTMLElement | null;
    if (target) {
      const tag = target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (target.isContentEditable) return;
    }
    if (!askFilterInputEl) return;
    event.preventDefault();
    askFilterInputEl.focus();
    askFilterInputEl.select();
  }

  function resolveRoomNameSafely(roomId: string): string {
    return roomNameByRoomId[roomId] ?? roomId;
  }

  function describeAnsweredAt(ask: Ask): string {
    if (!ask.answeredAt) return '';
    const moment = new Date(ask.answeredAt);
    if (Number.isNaN(moment.getTime())) return ask.answeredAt;
    return moment.toLocaleString();
  }

  function clearErrorFor(askId: string) {
    if (!lastErrorByAskId[askId]) return;
    const { [askId]: _removed, ...rest } = lastErrorByAskId;
    lastErrorByAskId = rest;
  }
  function setErrorFor(askId: string, message: string) {
    lastErrorByAskId = { ...lastErrorByAskId, [askId]: message };
  }

  function openAnswerFormFor(askId: string) {
    activeAnswerAskId = askId;
    answerText = '';
    clearErrorFor(askId);
  }
  function cancelAnswerForm() {
    activeAnswerAskId = null;
    answerText = '';
  }

  async function submitAnswerFor(askId: string) {
    const trimmedAnswer = answerText.trim();
    if (trimmedAnswer.length === 0) return;
    inFlightAskId = askId;
    inFlightVerb = 'answer';
    clearErrorFor(askId);
    try {
      await askActionsAnswer({
        askId,
        actorHandle: ACTOR_HANDLE,
        answer: trimmedAnswer
      });
      activeAnswerAskId = null;
      answerText = '';
      await invalidateAll();
    } catch (causeOfFailure) {
      setErrorFor(askId, causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not answer the ask.');
    } finally {
      inFlightAskId = null;
      inFlightVerb = null;
    }
  }

  async function submitDismissFor(askId: string) {
    inFlightAskId = askId;
    inFlightVerb = 'dismiss';
    clearErrorFor(askId);
    try {
      await askActionsDismiss({ askId, actorHandle: ACTOR_HANDLE });
      if (activeAnswerAskId === askId) activeAnswerAskId = null;
      await invalidateAll();
    } catch (causeOfFailure) {
      setErrorFor(askId, causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not dismiss the ask.');
    } finally {
      inFlightAskId = null;
      inFlightVerb = null;
    }
  }
</script>

<svelte:head>
  <title>Asks | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow="Asks"
  title="Open questions across every room."
  summary="The cross-room queue of asks. Answer to add a reply, dismiss to take it off the list."
>
  {#if asksFetchFailed}
    <p class="error-message" role="alert">
      Could not load the asks queue. Try again in a moment.
    </p>
  {:else}
    {#if asksFromServer.length > 0 || recentlyAnsweredFromServer.length > 0}
      <div class="ask-filter-row">
        <input
          bind:this={askFilterInputEl}
          type="search"
          class="ask-filter"
          placeholder="Filter by title or room… (press / to focus)"
          aria-label="Filter asks by title or room name. Press / to focus."
          bind:value={askFilter}
        />
        {#if askFilter.trim().length > 0}
          <span class="ask-filter-count" aria-live="polite">
            {filteredOpenAsks.length} open · {filteredAnsweredAsks.length} answered
          </span>
        {/if}
      </div>
    {/if}

    {#if isFiltering && !hasFilteredResults}
      <!-- Unified no-results state: filter eliminates everything across
           BOTH Open and Recently-answered. Replaces the section-local
           empty-after-filter rendering so the operator gets one Clear
           button regardless of which section would have shown results. -->
      <p class="empty-nudge" role="status">
        No asks match "<strong>{askFilter}</strong>".
        <button type="button" class="filter-reset-btn" onclick={() => (askFilter = '')}>Clear filter</button>
      </p>
    {:else if !isFiltering && asksFromServer.length === 0}
      <div class="empty-celebrate" role="status" aria-label="All open asks resolved">
        <span class="celebrate-icon" aria-hidden="true">✓</span>
        <div class="celebrate-text">
          <strong>All caught up.</strong>
          <span class="celebrate-detail">No open asks right now. New ones appear here automatically when a member opens one from inside a room.</span>
        </div>
      </div>
    {:else if filteredOpenAsks.length === 0 && filteredAnsweredAsks.length > 0}
      <!-- Filtering matched answered but not open: keep the Open header
           area quiet (the empty-nudge would be misleading next to a
           non-empty Recently-answered list). -->
    {:else}
      <ul class="ask-list" aria-label="Open asks queue">
        {#each filteredOpenAsks as ask (ask.id)}
          <li>
            <AskCard
              ask={ask}
              roomNameLabel={resolveRoomNameSafely(ask.roomId)}
              isAnswerFormOpen={activeAnswerAskId === ask.id}
              isInFlightAsAnswer={inFlightAskId === ask.id && inFlightVerb === 'answer'}
              isInFlightAsDismiss={inFlightAskId === ask.id && inFlightVerb === 'dismiss'}
              lastErrorMessage={lastErrorByAskId[ask.id]}
              answerText={activeAnswerAskId === ask.id ? answerText : ''}
              onOpenAnswerForm={() => openAnswerFormFor(ask.id)}
              onCancelAnswerForm={cancelAnswerForm}
              onAnswerTextChange={(next) => (answerText = next)}
              onSubmitAnswer={() => submitAnswerFor(ask.id)}
              onSubmitDismiss={() => submitDismissFor(ask.id)}
            />
          </li>
        {/each}
      </ul>
    {/if}

    {#if filteredAnsweredAsks.length > 0}
      <section class="answered-section" aria-labelledby="recently-answered-heading">
        <h2 id="recently-answered-heading">Recently answered</h2>
        <ul class="answered-list">
          {#each filteredAnsweredAsks as ask (ask.id)}
            {@const pickup = pickupByAskId[ask.id]}
            <li class="answered-card">
              <header class="answered-meta">
                <a href="/rooms/{ask.roomId}">{resolveRoomNameSafely(ask.roomId)}</a>
                <span>{ask.answeredByDisplayName ?? ask.answeredByHandle ?? 'Answered'}</span>
                <span class="answered-time">{describeAnsweredAt(ask)}</span>
              </header>
              <h3>{ask.title}</h3>
              <p class="answer-text">{ask.answer}</p>
              {#if pickup}
                {#if pickup.messagesAfterAnswer === 0}
                  <p class="pickup-status pickup-status-quiet" aria-label="No activity since answer">
                    <span class="pickup-dot pickup-dot-quiet" aria-hidden="true"></span>
                    No activity in the room since you answered.
                  </p>
                {:else}
                  <p class="pickup-status pickup-status-active" aria-label={`${pickup.messagesAfterAnswer} messages since answer from ${pickup.distinctAgentsAfterAnswer} agents`}>
                    <span class="pickup-dot pickup-dot-active" aria-hidden="true"></span>
                    <strong>{pickup.messagesAfterAnswer}</strong>
                    message{pickup.messagesAfterAnswer === 1 ? '' : 's'}
                    since · <strong>{pickup.distinctAgentsAfterAnswer}</strong>
                    agent{pickup.distinctAgentsAfterAnswer === 1 ? '' : 's'} acted
                    {#if pickup.agentsAfterAnswer.length > 0}
                      <span class="pickup-handles">({pickup.agentsAfterAnswer.slice(0, 4).join(', ')}{pickup.agentsAfterAnswer.length > 4 ? '…' : ''})</span>
                    {/if}
                    {#if pickup.firstMessageAfterAnswer}
                      <a class="pickup-first" href="/rooms/{ask.roomId}#{pickup.firstMessageAfterAnswer.messageId}" title={pickup.firstMessageAfterAnswer.bodyPreview}>jump to first reply →</a>
                    {/if}
                  </p>
                {/if}
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}
  {/if}
</SimplePageShell>

<style>
  .error-message { margin: 0 0 0.75rem; color: var(--accent); }

  /* Ask filter input (mirrors /rooms d08bc69 / e059268 affordance).
     Type to narrow both Open and Recently-answered lists by title or
     room name. "/" focuses the input. */
  .ask-filter-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    margin: 0 0 0.85rem;
  }
  .ask-filter {
    flex: 1 1 16rem;
    padding: 0.55rem 0.85rem;
    font: inherit;
    font-size: 0.92rem;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
  }
  .ask-filter:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .ask-filter-count {
    color: var(--ink-muted, #8a7a70);
    font-size: 0.78rem;
    font-weight: 700;
    white-space: nowrap;
  }
  .empty-nudge {
    margin: 0 0 1rem;
    padding: 0.85rem 1rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.85rem;
    background: var(--bg);
    color: var(--ink-strong);
    line-height: 1.5;
  }
  .filter-reset-btn {
    margin-left: 0.5rem;
    padding: 0.25rem 0.75rem;
    background: transparent;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink);
    font-weight: 700;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .filter-reset-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }
  /* Celebratory empty-state for an empty asks queue: replaces the
     bland "no asks" string with a small green check + reassuring copy
     so the operator gets a positive signal that nothing's waiting. */
  .empty-celebrate {
    display: flex;
    align-items: center;
    gap: 0.95rem;
    padding: 1rem 1.1rem;
    border: 1px solid color-mix(in srgb, var(--ok) 35%, var(--line-soft));
    border-radius: 0.95rem;
    background: color-mix(in srgb, var(--ok) 12%, var(--surface-card));
  }
  .celebrate-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 2rem;
    height: 2rem;
    border-radius: 999px;
    background: var(--ok);
    color: white;
    font-weight: 900;
    flex-shrink: 0;
  }
  .celebrate-text {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    color: var(--ink-strong);
  }
  .celebrate-text strong { font-size: 0.98rem; }
  .celebrate-detail { color: var(--ink-soft); font-size: 0.85rem; line-height: 1.4; }
  .ask-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.7rem; }
  .answered-section { margin-top: 1rem; }
  .answered-section h2 { margin: 0 0 0.6rem; font-size: 1rem; color: var(--ink-strong); }
  .answered-list { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.55rem; }
  .answered-card {
    padding: 0.85rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--surface) 82%, var(--bg));
  }
  .answered-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.55rem;
    margin-bottom: 0.35rem;
    color: var(--ink-soft);
    font-size: 0.84rem;
  }
  .answered-meta a { color: var(--accent); font-weight: 700; text-decoration: none; }
  .answered-meta a:hover { text-decoration: underline; }
  .answered-time { margin-left: auto; font-variant-numeric: tabular-nums; }
  .answered-card h3 { margin: 0 0 0.25rem; font-size: 0.98rem; color: var(--ink-strong); }
  .answer-text { margin: 0; color: var(--ink); line-height: 1.45; white-space: pre-wrap; }
  /* Ask-pickup notice line — sits at the foot of each Recently-answered
     card. Quiet style for 'nothing happened since' (informational, not
     alarming); active style for 'N agents acted'. Both use a leading dot
     for at-a-glance status read. JWPK task 3947e563. */
  .pickup-status {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.4rem;
    margin: 0.55rem 0 0;
    padding: 0.35rem 0.55rem;
    border-radius: 0.5rem;
    font-size: 0.8rem;
  }
  .pickup-status-quiet {
    background: var(--bg);
    color: var(--ink-soft);
    border: 1px dashed var(--line-soft);
  }
  .pickup-status-active {
    background: color-mix(in srgb, var(--ok) 8%, var(--surface-card));
    color: var(--ink-strong);
    border: 1px solid color-mix(in srgb, var(--ok) 25%, var(--line-soft));
  }
  .pickup-status strong { color: var(--ink-strong); }
  .pickup-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .pickup-dot-quiet  { background: var(--ink-muted); opacity: 0.6; }
  .pickup-dot-active { background: var(--ok); }
  .pickup-handles { color: var(--ink-soft); font-size: 0.75rem; font-family: ui-monospace, monospace; }
  .pickup-first {
    margin-left: auto;
    color: var(--accent);
    font-size: 0.75rem;
    font-weight: 700;
    text-decoration: none;
  }
  .pickup-first:hover { text-decoration: underline; }
</style>
