<!--
  CreateChatRoomForm — the composer for M01 start-a-chatroom.
  Wireframe board GYPJ2 in antv5-wireframes.pen (Claude lane, x=-6200 y=600).

  Five states the form moves through:
    1. emptyComposerWaitingForName
    2. nameBeingTyped
    3. submittingToServer
    4. justCreatedShowSuccess
    5. failedToCreateShowError
-->
<script lang="ts">
  import { tick } from 'svelte';

  type FormState =
    | 'emptyComposerWaitingForName'
    | 'nameBeingTyped'
    | 'submittingToServer'
    | 'justCreatedShowSuccess'
    | 'failedToCreateShowError';

  type Props = {
    onRoomCreated?: (newRoomName: string) => void;
  };

  let { onRoomCreated }: Props = $props();

  // Description cap matches ROOM_DESCRIPTION_MAX_CHARS on the server
  // (chatRoomStore). Kept here as a UI mirror to drive maxlength + the
  // small char count below; server is the source of truth.
  const DESCRIPTION_MAX = 240;

  let nameForNewRoom = $state('');
  let descriptionForNewRoom = $state('');
  let formState = $state<FormState>('emptyComposerWaitingForName');
  let mostRecentlyCreatedName = $state('');
  let lastErrorMessage = $state('');
  let roomNameInput = $state<HTMLInputElement | undefined>();

  function handleNameInput(value: string) {
    nameForNewRoom = value;
    if (value.trim().length === 0) {
      formState = 'emptyComposerWaitingForName';
    } else {
      formState = 'nameBeingTyped';
    }
  }

  async function submitNewRoom() {
    const trimmedName = nameForNewRoom.trim();
    if (trimmedName.length === 0) {
      return;
    }

    formState = 'submittingToServer';

    const trimmedDescription = descriptionForNewRoom.trim();
    try {
      const response = await fetch('/api/chat-rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          name: trimmedName,
          ...(trimmedDescription.length > 0 && { description: trimmedDescription })
        })
      });

      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not create the room.');
      }

      mostRecentlyCreatedName = trimmedName;
      nameForNewRoom = '';
      descriptionForNewRoom = '';
      formState = 'justCreatedShowSuccess';
      onRoomCreated?.(trimmedName);
    } catch (causeOfFailure) {
      lastErrorMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not create the room.';
      formState = 'failedToCreateShowError';
    }
  }

  async function startAnotherRoom() {
    formState = 'emptyComposerWaitingForName';
    nameForNewRoom = '';
    descriptionForNewRoom = '';
    lastErrorMessage = '';
    await tick();
    roomNameInput?.focus();
  }
</script>

<section class="create-chat-room-form" aria-labelledby="createChatRoomHeading">
  <h2 id="createChatRoomHeading">Start a chat room</h2>

  {#if formState === 'justCreatedShowSuccess'}
    <p class="success-message" role="status">
      Created <strong>{mostRecentlyCreatedName}</strong>. Invite an agent or post a first message
      to get it moving.
    </p>
    <button type="button" class="primary" onclick={startAnotherRoom}>
      Start another room
    </button>
  {:else if formState === 'failedToCreateShowError'}
    <p class="error-message" role="alert">
      That did not work: {lastErrorMessage}
    </p>
    <button type="button" class="primary" onclick={startAnotherRoom}>
      Try again
    </button>
  {:else}
    <form
      onsubmit={(submitEvent) => {
        submitEvent.preventDefault();
        submitNewRoom();
      }}
    >
      <label for="roomNameField">Give the room a name</label>
      <input
        bind:this={roomNameInput}
        id="roomNameField"
        type="text"
        autocomplete="off"
        placeholder="e.g. fresh-ant build"
        value={nameForNewRoom}
        oninput={(event) => handleNameInput(event.currentTarget.value)}
        disabled={formState === 'submittingToServer'}
      />

      <label for="roomDescriptionField" class="optional-label">
        Description <span class="optional-hint">(optional)</span>
      </label>
      <textarea
        id="roomDescriptionField"
        rows="2"
        maxlength={DESCRIPTION_MAX}
        placeholder="What's this room for? Up to {DESCRIPTION_MAX} characters."
        value={descriptionForNewRoom}
        oninput={(event) => (descriptionForNewRoom = (event.currentTarget as HTMLTextAreaElement).value)}
        disabled={formState === 'submittingToServer'}
      ></textarea>
      {#if descriptionForNewRoom.length > 0}
        <span class="char-count" aria-live="polite">{descriptionForNewRoom.length}/{DESCRIPTION_MAX}</span>
      {/if}

      <button
        type="submit"
        class="primary"
        disabled={formState !== 'nameBeingTyped'}
      >
        {#if formState === 'submittingToServer'}
          Creating…
        {:else}
          Create room
        {/if}
      </button>
    </form>
  {/if}
</section>

<style>
  .create-chat-room-form {
    display: flex;
    flex-direction: column;
    gap: 0.85rem;
    padding: 1.25rem 1.4rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }

  h2 {
    font-size: 1.05rem;
    font-weight: 800;
    margin: 0;
    color: var(--ink-strong);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }

  label {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
  }

  input {
    padding: 0.7rem 0.85rem;
    font-size: 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--bg);
    color: var(--ink-strong);
  }

  input:focus,
  textarea:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  textarea {
    padding: 0.55rem 0.85rem;
    font: inherit;
    font-size: 0.92rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--bg);
    color: var(--ink-strong);
    resize: vertical;
    min-height: 2.5rem;
  }

  .optional-label {
    margin-top: 0.25rem;
  }
  .optional-hint {
    color: var(--ink-muted, #8a7a70);
    font-weight: 600;
    font-size: 0.78rem;
    margin-left: 0.2rem;
  }

  .char-count {
    align-self: flex-end;
    margin-top: -0.35rem;
    color: var(--ink-muted, #8a7a70);
    font-size: 0.72rem;
  }

  button.primary {
    align-self: flex-start;
    padding: 0.6rem 1.1rem;
    font-weight: 800;
    font-size: 0.95rem;
    color: white;
    background: var(--accent);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }

  button.primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  .success-message {
    margin: 0;
    color: var(--ink);
  }

  .error-message {
    margin: 0;
    color: var(--accent);
  }
</style>
