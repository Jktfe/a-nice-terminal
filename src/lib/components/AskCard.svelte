<!--
  AskCard — pure render of one ask card with answer/dismiss controls.
  Backs asks UI slice 3 (extract from /asks page per @evolveantcodex split).

  PURE RENDER + CALLBACK PROPS ONLY. No fetch, no invalidateAll, no store
  or endpoint imports. The /asks page owns all data + side effects and
  passes event handlers in. This keeps the card stateless and re-usable
  for a later per-room AsksPanel slice.

  Slots are tied to /asks page state:
    - isAnswerFormOpen: parent decides which card has the form open.
    - answerText: bindable from the parent so the textarea stays in sync.
    - isInFlightAsAnswer / isInFlightAsDismiss: parent flags for the disabled
      attributes on each action.
    - lastErrorMessage: parent-provided string shown under the card.
-->
<script lang="ts">
  import Explainable from './Explainable.svelte';
  import type { Ask } from '$lib/server/askStore';

  type Props = {
    ask: Ask;
    roomNameLabel: string;
    isAnswerFormOpen: boolean;
    isInFlightAsAnswer: boolean;
    isInFlightAsDismiss: boolean;
    lastErrorMessage: string | undefined;
    answerText: string;
    onOpenAnswerForm: () => void;
    onCancelAnswerForm: () => void;
    onAnswerTextChange: (next: string) => void;
    onSubmitAnswer: () => void;
    onSubmitDismiss: () => void;
  };

  let {
    ask,
    roomNameLabel,
    isAnswerFormOpen,
    isInFlightAsAnswer,
    isInFlightAsDismiss,
    lastErrorMessage,
    answerText,
    onOpenAnswerForm,
    onCancelAnswerForm,
    onAnswerTextChange,
    onSubmitAnswer,
    onSubmitDismiss
  }: Props = $props();

  function describeOpenedAt(openedAt: string): string {
    const moment = new Date(openedAt);
    if (Number.isNaN(moment.getTime())) return openedAt;
    return moment.toLocaleString();
  }
</script>

<article class="ask-card">
  <header class="ask-header">
    <a class="room-link" href="/rooms/{ask.roomId}">{roomNameLabel}</a>
    <span class="opener">{ask.openedByDisplayName}</span>
    <span class="opened-time">{describeOpenedAt(ask.openedAt)}</span>
  </header>
  <h2 class="ask-title">{ask.title}</h2>
  <p class="ask-body">{ask.body}</p>

  {#if isAnswerFormOpen}
    <form
      class="answer-form"
      onsubmit={(submitEvent) => {
        submitEvent.preventDefault();
        onSubmitAnswer();
      }}
    >
      <label for={`answerField-${ask.id}`} class="visually-hidden">Your answer</label>
      <textarea
        id={`answerField-${ask.id}`}
        value={answerText}
        oninput={(event) => onAnswerTextChange(event.currentTarget.value)}
        rows="3"
        placeholder="Type your answer…"
        disabled={isInFlightAsAnswer}
      ></textarea>
      <div class="form-actions">
        <button
          type="submit"
          class="primary"
          disabled={answerText.trim().length === 0 || isInFlightAsAnswer}
        >
          {#if isInFlightAsAnswer}Submitting…{:else}Submit answer{/if}
        </button>
        <button type="button" class="ghost" onclick={onCancelAnswerForm} disabled={isInFlightAsAnswer}>
          Cancel
        </button>
      </div>
    </form>
  {:else}
    <Explainable explainKey="asks-answer">
    <div class="card-actions">
      <button type="button" class="primary" onclick={onOpenAnswerForm} disabled={isInFlightAsAnswer || isInFlightAsDismiss}>
        Answer
      </button>
      <button type="button" class="ghost" onclick={onSubmitDismiss} disabled={isInFlightAsAnswer || isInFlightAsDismiss}>
        {#if isInFlightAsDismiss}Dismissing…{:else}Dismiss{/if}
      </button>
    </div>
    </Explainable>
  {/if}

  {#if lastErrorMessage}
    <p class="card-error" role="alert">{lastErrorMessage}</p>
  {/if}
</article>

<style>
  .ask-card {
    padding: 0.95rem 1.1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.7rem;
    background: var(--surface);
  }
  .ask-header { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.55rem; margin-bottom: 0.4rem; font-size: 0.85rem; color: var(--ink-soft); }
  .room-link { font-weight: 700; color: var(--accent); text-decoration: none; }
  .room-link:hover { text-decoration: underline; }
  .opener { font-weight: 600; color: var(--ink); }
  .opened-time { margin-left: auto; font-variant-numeric: tabular-nums; }
  .ask-title { margin: 0 0 0.3rem; font-size: 1.05rem; color: var(--ink-strong); }
  .ask-body { margin: 0 0 0.55rem; line-height: 1.45; color: var(--ink); white-space: pre-wrap; }
  .card-actions, .form-actions { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .answer-form { display: flex; flex-direction: column; gap: 0.45rem; }
  textarea {
    width: 100%;
    box-sizing: border-box;
    padding: 0.5rem 0.65rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    resize: vertical;
  }
  textarea:focus { outline: 2px solid var(--accent); outline-offset: 1px; }
  button.primary, button.ghost {
    padding: 0.4rem 0.95rem;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }
  button.primary { background: var(--accent); color: white; border: none; }
  button.ghost { background: transparent; border: 1px solid var(--surface-edge); color: var(--ink); }
  button.primary:disabled, button.ghost:disabled { opacity: 0.55; cursor: not-allowed; }
  .card-error {
    margin: 0.55rem 0 0;
    padding: 0.45rem 0.7rem;
    border: 1px solid var(--accent);
    border-radius: 0.45rem;
    background: color-mix(in srgb, var(--accent) 10%, var(--bg));
    color: var(--ink-strong);
    font-size: 0.85rem;
  }
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
</style>
