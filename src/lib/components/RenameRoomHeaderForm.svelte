<!--
  RenameRoomHeaderForm — pencil + inline edit for the room name.
  Backs M13 rename-a-chatroom (wireframe board bBkBw).

  Sits in the room header. Default state shows the room name with a pencil
  button next to it; clicking the pencil enters edit mode with a text field
  + Save/Cancel. Save PATCHes /api/chat-rooms/:roomId/name, the server posts
  a system message, the page refreshes via invalidateAll().

  Four states the form moves through:
    1. headerShowingName
    2. nameBeingEdited
    3. submittingToServer
    4. failedToSaveShowError
-->
<script lang="ts">
  import { invalidateAll } from '$app/navigation';

  type FormState =
    | 'headerShowingName'
    | 'nameBeingEdited'
    | 'submittingToServer'
    | 'failedToSaveShowError';

  type Props = {
    roomId: string;
    currentName: string;
  };

  let { roomId, currentName }: Props = $props();

  let formState = $state<FormState>('headerShowingName');
  let proposedName = $state('');
  let lastErrorMessage = $state('');
  let inputElement = $state<HTMLInputElement | null>(null);
  let pencilButton = $state<HTMLButtonElement | null>(null);
  let userHasInteracted = $state(false);

  // Focus handoff: when the user opens the rename form, focus the input;
  // when an error puts them back in edit mode, refocus the input; when the
  // form closes after Cancel/Save, return focus to the pencil button so
  // keyboard users are never dropped on document.body. The interaction
  // flag prevents stealing focus on first mount (when state starts as
  // headerShowingName and the pencil button is already in the DOM).
  $effect(() => {
    if (!userHasInteracted) return;
    if (formState === 'nameBeingEdited' && inputElement) {
      inputElement.focus();
      inputElement.select();
      return;
    }
    if (formState === 'failedToSaveShowError' && inputElement) {
      inputElement.focus();
      return;
    }
    if (formState === 'headerShowingName' && pencilButton) {
      pencilButton.focus();
    }
  });

  function beginEditing() {
    userHasInteracted = true;
    proposedName = currentName;
    lastErrorMessage = '';
    formState = 'nameBeingEdited';
  }

  function cancelEditing() {
    proposedName = '';
    lastErrorMessage = '';
    formState = 'headerShowingName';
  }

  async function submitNewName() {
    const trimmed = proposedName.trim();
    if (trimmed.length === 0) return;
    if (trimmed === currentName) {
      cancelEditing();
      return;
    }

    formState = 'submittingToServer';
    try {
      const response = await fetch(`/api/chat-rooms/${roomId}/name`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ newName: trimmed })
      });
      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not rename the room.');
      }
      proposedName = '';
      formState = 'headerShowingName';
      await invalidateAll();
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not rename the room.';
      formState = 'failedToSaveShowError';
    }
  }

  function handleKeydown(keyboardEvent: KeyboardEvent) {
    if (keyboardEvent.key === 'Escape') {
      keyboardEvent.preventDefault();
      cancelEditing();
      return;
    }
    if (keyboardEvent.key === 'Enter' && !keyboardEvent.shiftKey) {
      keyboardEvent.preventDefault();
      submitNewName();
    }
  }
</script>

{#if formState === 'headerShowingName'}
  <div class="rename-header">
    <span class="room-name">{currentName}</span>
    <button
      type="button"
      class="pencil-button"
      aria-label="Rename room"
      bind:this={pencilButton}
      onclick={beginEditing}
    >
      ✎
    </button>
  </div>
{:else}
  <form
    class="rename-form"
    onsubmit={(submitEvent) => {
      submitEvent.preventDefault();
      submitNewName();
    }}
  >
    <input
      class="rename-input"
      type="text"
      autocomplete="off"
      aria-label="New room name"
      bind:this={inputElement}
      value={proposedName}
      oninput={(event) => {
        proposedName = event.currentTarget.value;
        if (lastErrorMessage) lastErrorMessage = '';
        if (formState === 'failedToSaveShowError') formState = 'nameBeingEdited';
      }}
      onkeydown={handleKeydown}
      disabled={formState === 'submittingToServer'}
    />
    <button
      type="submit"
      class="primary"
      disabled={proposedName.trim().length === 0 || formState === 'submittingToServer'}
    >
      {#if formState === 'submittingToServer'}Saving…{:else}Save{/if}
    </button>
    <button
      type="button"
      class="ghost"
      onclick={cancelEditing}
      disabled={formState === 'submittingToServer'}
    >
      Cancel
    </button>
    {#if lastErrorMessage}
      <p class="error-message" role="alert">{lastErrorMessage}</p>
    {/if}
  </form>
{/if}

<style>
  .rename-header {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
  }

  .room-name {
    font-weight: 800;
  }

  .pencil-button {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 0.4rem;
    padding: 0.15rem 0.4rem;
    cursor: pointer;
    color: var(--ink-soft);
    font-size: 0.95rem;
  }

  .pencil-button:hover {
    border-color: var(--surface-edge);
    color: var(--accent);
  }

  .rename-form {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .rename-input {
    padding: 0.35rem 0.55rem;
    font-size: 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-strong);
    min-width: 14rem;
  }

  .rename-input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  button.primary {
    padding: 0.35rem 0.85rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 700;
    cursor: pointer;
  }

  button.primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  button.ghost {
    padding: 0.35rem 0.85rem;
    background: transparent;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink);
    font-weight: 700;
    cursor: pointer;
  }

  .error-message {
    flex-basis: 100%;
    margin: 0;
    color: var(--accent);
    font-size: 0.8rem;
  }
</style>
