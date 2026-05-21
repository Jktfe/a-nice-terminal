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

  let nameForNewRoom = $state('');
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

    try {
      const response = await fetch('/api/chat-rooms', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: trimmedName, whoCreatedIt: '@you' })
      });

      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not create the room.');
      }

      mostRecentlyCreatedName = trimmedName;
      nameForNewRoom = '';
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

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
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
