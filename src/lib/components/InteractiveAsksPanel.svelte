<!--
  InteractiveAsksPanel — in-room asks widget with Answer / Dismiss actions
  (M22 slice 2). Supersedes the slice 1 read-only AsksPanel; the room
  page mount swaps to this component as part of the slice 2 boundary.

  Owns local state, calls into shared askActions transport, and runs
  invalidateAll() on success so the room loader re-fetches the open-asks
  list and the resolved ask drops out. Uses AskCard verbatim (asks UI
  slice 3 baseline) — no AskCard edit in this slice.

  Per @evolveantcodex + @codex2 slice 2 boundary:
    - Imports limited to AskCard + askActions + invalidateAll + Ask type.
    - askActions is transport-only (no invalidateAll/state); this panel
      owns invalidateAll + per-ask state + ACTOR_HANDLE constant.
    - ACTOR_HANDLE = "@you" mirrors /asks page constant.
    - Backend membership-before-validation guards handle @you membership
      — non-member 404 surfaces as inline lastErrorByAskId message under
      the offending card.
    - Resolved (answered/dismissed) asks drop from listOpenAsksInRoom on
      the next loader run, so invalidateAll is enough to make them
      disappear from the panel.
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';
  import AskCard from '$lib/components/AskCard.svelte';
  import { submitAnswerFor, submitDismissFor } from '$lib/askActions';
  import type { Ask } from '$lib/server/askStore';

  const ACTOR_HANDLE = '@you';

  type Props = {
    asksFromServer: Ask[];
    asksFetchFailed: boolean;
    // Slice 2 B1 fix: AskCard always renders roomNameLabel as the room
    // link text. The in-room panel must provide a meaningful label so
    // the link is not empty (a11y / render contract). The room page
    // passes the current room's name; the link is a self-link but
    // labelled, which is valid HTML.
    roomNameLabel: string;
  };

  let { asksFromServer, asksFetchFailed, roomNameLabel }: Props = $props();

  let activeAnswerAskId = $state<string | null>(null);
  let answerText = $state('');
  let inFlightAskId = $state<string | null>(null);
  let inFlightVerb = $state<'answer' | 'dismiss' | null>(null);
  let lastErrorByAskId = $state<Record<string, string>>({});

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

  async function submitAnswerForAsk(askId: string) {
    const trimmedAnswer = answerText.trim();
    if (trimmedAnswer.length === 0) return;
    inFlightAskId = askId;
    inFlightVerb = 'answer';
    clearErrorFor(askId);
    try {
      await submitAnswerFor({
        askId,
        actorHandle: ACTOR_HANDLE,
        answer: trimmedAnswer
      });
      activeAnswerAskId = null;
      answerText = '';
      await invalidateAll();
    } catch (causeOfFailure) {
      setErrorFor(
        askId,
        causeOfFailure instanceof Error
          ? causeOfFailure.message
          : 'Could not answer the ask.'
      );
    } finally {
      inFlightAskId = null;
      inFlightVerb = null;
    }
  }

  async function submitDismissForAsk(askId: string) {
    inFlightAskId = askId;
    inFlightVerb = 'dismiss';
    clearErrorFor(askId);
    try {
      await submitDismissFor({ askId, actorHandle: ACTOR_HANDLE });
      if (activeAnswerAskId === askId) activeAnswerAskId = null;
      await invalidateAll();
    } catch (causeOfFailure) {
      setErrorFor(
        askId,
        causeOfFailure instanceof Error
          ? causeOfFailure.message
          : 'Could not dismiss the ask.'
      );
    } finally {
      inFlightAskId = null;
      inFlightVerb = null;
    }
  }
</script>

<section class="interactive-asks-panel" aria-labelledby="room-asks-heading">
  <h2 id="room-asks-heading" class="panel-heading">Open asks in this room</h2>

  {#if asksFetchFailed}
    <p class="panel-message" role="alert">
      Could not load asks for this room. Try refreshing in a moment.
    </p>
  {:else if asksFromServer.length === 0}
    <p class="panel-message empty">
      No open asks in this room. New asks will appear here when they are opened.
    </p>
  {:else}
    <ul class="ask-list" aria-label="Open asks in this room">
      {#each asksFromServer as ask (ask.id)}
        <li>
          <AskCard
            ask={ask}
            roomNameLabel={roomNameLabel}
            isAnswerFormOpen={activeAnswerAskId === ask.id}
            isInFlightAsAnswer={inFlightAskId === ask.id && inFlightVerb === 'answer'}
            isInFlightAsDismiss={inFlightAskId === ask.id && inFlightVerb === 'dismiss'}
            lastErrorMessage={lastErrorByAskId[ask.id]}
            answerText={activeAnswerAskId === ask.id ? answerText : ''}
            onOpenAnswerForm={() => openAnswerFormFor(ask.id)}
            onCancelAnswerForm={cancelAnswerForm}
            onAnswerTextChange={(next) => (answerText = next)}
            onSubmitAnswer={() => submitAnswerForAsk(ask.id)}
            onSubmitDismiss={() => submitDismissForAsk(ask.id)}
          />
        </li>
      {/each}
    </ul>
  {/if}

  <p class="manage-link-wrap">
    <a class="manage-link" href="/asks">Manage all asks</a>
  </p>
</section>

<style>
  .interactive-asks-panel {
    margin-top: 1rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.7rem;
    background: var(--surface);
  }
  .panel-heading {
    margin: 0 0 0.55rem;
    font-size: 1rem;
    color: var(--ink-strong);
  }
  .panel-message { margin: 0 0 0.5rem; color: var(--ink-soft); line-height: 1.45; }
  .panel-message.empty { color: var(--ink-soft); }
  .ask-list {
    list-style: none;
    padding: 0;
    margin: 0 0 0.6rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .manage-link-wrap { margin: 0.25rem 0 0; }
  .manage-link {
    color: var(--accent);
    font-weight: 700;
    text-decoration: none;
  }
  .manage-link:hover { text-decoration: underline; }
</style>
