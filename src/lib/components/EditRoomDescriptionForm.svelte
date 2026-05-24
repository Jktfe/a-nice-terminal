<!--
  EditRoomDescriptionForm — inline edit for the room's optional
  user/agent-authored description (JWPK 2026-05-24 yz4clwzvbm
  msg_jj50zw48fr). Shape mirrors RenameRoomHeaderForm so the room
  header feels coherent: pencil → input → Save/Cancel → invalidate.

  Distinct from RenameRoomHeaderForm by:
    - longer text area (textarea, max 240 chars)
    - empty submit = clear (PATCH with description: null)
    - shows current description as placeholder context

  PATCHes /api/chat-rooms/:roomId/description. Server posts a system
  message and the page refreshes via invalidateAll().
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  const MAX_CHARS = 240;

  type FormState =
    | 'idle'
    | 'editing'
    | 'submitting'
    | 'failed';

  type Props = {
    roomId: string;
    currentDescription: string | null;
  };

  let { roomId, currentDescription }: Props = $props();

  let formState = $state<FormState>('idle');
  let proposedDescription = $state('');
  let lastErrorMessage = $state('');
  let inputElement = $state<HTMLTextAreaElement | null>(null);

  function beginEditing() {
    proposedDescription = currentDescription ?? '';
    lastErrorMessage = '';
    formState = 'editing';
    queueMicrotask(() => inputElement?.focus());
  }

  function cancelEditing() {
    proposedDescription = '';
    lastErrorMessage = '';
    formState = 'idle';
  }

  async function submitDescription() {
    const trimmed = proposedDescription.trim();
    const valueToSend: string | null = trimmed.length === 0 ? null : trimmed;
    // Skip the round-trip if nothing changed.
    if (valueToSend === (currentDescription ?? null)) {
      cancelEditing();
      return;
    }

    formState = 'submitting';
    try {
      const response = await fetch(`/api/chat-rooms/${roomId}/description`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ description: valueToSend })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not update the description.');
      }
      proposedDescription = '';
      formState = 'idle';
      await invalidateAll();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not update the description.';
      formState = 'failed';
    }
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      event.preventDefault();
      cancelEditing();
      return;
    }
    // Cmd/Ctrl+Enter to save — plain Enter inserts a newline.
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      submitDescription();
    }
  }
</script>

{#if formState === 'idle'}
  <div class="description-row">
    {#if currentDescription}
      <span class="description-text">{currentDescription}</span>
    {:else}
      <span class="description-placeholder">No description yet.</span>
    {/if}
    <button
      type="button"
      class="pencil-button"
      aria-label={currentDescription ? 'Edit room description' : 'Add room description'}
      onclick={beginEditing}
    >
      ✎
    </button>
  </div>
{:else}
  <form
    class="description-form"
    onsubmit={(submitEvent) => {
      submitEvent.preventDefault();
      submitDescription();
    }}
  >
    <textarea
      class="description-input"
      aria-label="Room description"
      rows="2"
      maxlength={MAX_CHARS}
      bind:this={inputElement}
      value={proposedDescription}
      placeholder="A short description for this room (max {MAX_CHARS} chars). Empty saves clear it."
      oninput={(event) => {
        proposedDescription = (event.currentTarget as HTMLTextAreaElement).value;
        if (lastErrorMessage) lastErrorMessage = '';
        if (formState === 'failed') formState = 'editing';
      }}
      onkeydown={handleKeydown}
      disabled={formState === 'submitting'}
    ></textarea>
    <div class="actions">
      <button type="submit" class="primary" disabled={formState === 'submitting'}>
        {#if formState === 'submitting'}Saving…{:else}Save{/if}
      </button>
      <button type="button" class="ghost" onclick={cancelEditing} disabled={formState === 'submitting'}>
        Cancel
      </button>
      <span class="char-count" aria-live="polite">{proposedDescription.length}/{MAX_CHARS}</span>
    </div>
    {#if lastErrorMessage}
      <p class="error-message" role="alert">{lastErrorMessage}</p>
    {/if}
  </form>
{/if}

<style>
  .description-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    margin-top: 0.2rem;
  }
  .description-text {
    color: var(--ink-soft);
    font-size: 0.85rem;
    line-height: 1.3;
  }
  .description-placeholder {
    color: var(--ink-muted, #8a7a70);
    font-size: 0.8rem;
    font-style: italic;
  }
  .pencil-button {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.4rem;
    padding: 0.05rem 0.35rem;
    cursor: pointer;
    color: var(--ink-soft);
    font-size: 0.8rem;
  }
  .pencil-button:hover {
    border-color: var(--surface-edge);
    color: var(--accent);
  }
  .description-form {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    margin-top: 0.3rem;
  }
  .description-input {
    width: 100%;
    padding: 0.35rem 0.55rem;
    font: inherit;
    font-size: 0.85rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-strong);
    resize: vertical;
    min-height: 2.5rem;
  }
  .description-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  button.primary {
    padding: 0.25rem 0.75rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }
  button.primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  button.ghost {
    padding: 0.25rem 0.75rem;
    background: transparent;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink);
    font-weight: 700;
    font-size: 0.8rem;
    cursor: pointer;
  }
  .char-count {
    color: var(--ink-muted, #8a7a70);
    font-size: 0.75rem;
    margin-left: auto;
  }
  .error-message {
    margin: 0;
    color: var(--accent);
    font-size: 0.8rem;
  }
</style>
