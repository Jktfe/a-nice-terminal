<!--
  InviteAgentFormLocalPicker — the local typed-handle picker + submit
  half of InviteAgentForm. Owns availableHandles fetch + filtering +
  the POST /members invite. Parent (InviteAgentForm) owns the
  success/failure outcome view and resets via key remount.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  type FormState =
    | 'emptyComposerWaitingForHandle'
    | 'handleBeingTyped'
    | 'submittingToServer';

  type Props = {
    roomId: string;
    existingMemberHandles?: string[];
    onInviteSucceeded: (newAgentHandle: string) => void;
    onInviteFailed: (errorMessage: string) => void;
  };

  let {
    roomId,
    existingMemberHandles = [],
    onInviteSucceeded,
    onInviteFailed
  }: Props = $props();

  // Normalise the existing-members handle set (lower-case + @-prefix-stripped)
  // for case-insensitive comparison against the available picker handles.
  function normaliseHandleForCompare(h: string): string {
    return h.trim().toLowerCase().replace(/^@/, '');
  }
  const existingMemberSet = $derived(
    new Set(existingMemberHandles.map(normaliseHandleForCompare))
  );

  let handleBeingTyped = $state('');
  let formState = $state<FormState>('emptyComposerWaitingForHandle');

  // PICKER-DYNAMIC (2026-05-15, JWPK): chips are now sourced from real
  // terminals via /api/terminals/handles (union of explicit + derived
  // handles per terminalRecordsStore.listAllPickableHandles). Stays in
  // lockstep with the INVITE-VALIDATE gate so the picker can only offer
  // handles that POST /members will actually accept.
  let availableHandles = $state<string[]>([]);

  onMount(async () => {
    try {
      const response = await fetch('/api/terminals/handles');
      if (!response.ok) return;
      const payload = (await response.json()) as { handles?: unknown };
      if (Array.isArray(payload.handles)) {
        availableHandles = payload.handles.filter((h): h is string => typeof h === 'string');
      }
    } catch {
      // Network/parse failure leaves availableHandles empty — the form
      // still works (free-form typing path is unaffected; server-side
      // gate is the source of truth either way).
    }
  });

  // Picker = all available handles MINUS those already in the room
  // (JWPK msg_p40dikqhvl). Existing-member filter applies regardless of
  // the typed-search filter so a user typing a member's handle gets
  // the friendly empty-state instead of a clickable chip that would
  // 409 on submit.
  const eligibleHandles = $derived(
    availableHandles.filter((h) => !existingMemberSet.has(normaliseHandleForCompare(h)))
  );
  const filteredHandles = $derived.by(() => {
    const q = handleBeingTyped.trim().toLowerCase().replace(/^@/, '');
    if (q.length === 0) return eligibleHandles;
    return eligibleHandles.filter((h) => h.toLowerCase().replace(/^@/, '').includes(q));
  });

  function handleNameInput(value: string) {
    handleBeingTyped = value;
    if (value.trim().length === 0) {
      formState = 'emptyComposerWaitingForHandle';
    } else {
      formState = 'handleBeingTyped';
    }
  }

  function pickSuggestion(handle: string) {
    handleBeingTyped = handle;
    formState = 'handleBeingTyped';
  }

  async function submitInvite() {
    const trimmedHandle = handleBeingTyped.trim();
    if (trimmedHandle.length === 0) return;

    formState = 'submittingToServer';

    try {
      const response = await fetch(`/api/chat-rooms/${roomId}/members`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ agentHandle: trimmedHandle })
      });

      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not invite agent.');
      }

      const invitedHandle = trimmedHandle.startsWith('@')
        ? trimmedHandle
        : `@${trimmedHandle}`;
      handleBeingTyped = '';
      onInviteSucceeded(invitedHandle);
    } catch (causeOfFailure) {
      const message =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not invite agent.';
      onInviteFailed(message);
    }
  }
</script>

<form
  onsubmit={(submitEvent) => {
    submitEvent.preventDefault();
    submitInvite();
  }}
>
  <label for="agentHandleField">Type or pick a handle</label>
  <input
    id="agentHandleField"
    type="text"
    autocomplete="off"
    placeholder="@evolveantclaude"
    value={handleBeingTyped}
    oninput={(event) => handleNameInput(event.currentTarget.value)}
    disabled={formState === 'submittingToServer'}
  />

  <div class="suggestion-chips">
    {#each filteredHandles as handle (handle)}
      <button
        type="button"
        class="chip"
        onclick={() => pickSuggestion(handle)}
        disabled={formState === 'submittingToServer'}
      >
        <span class="chip-handle">{handle}</span>
      </button>
    {:else}
      {#if availableHandles.length === 0}
        <p class="picker-empty">
          No terminals yet — <a href="/terminals">launch one from the Terminals page</a> first.
        </p>
      {:else if eligibleHandles.length === 0}
        <p class="picker-empty">
          Every available terminal is already a member of this room. Launch a new one from
          <a href="/terminals">Terminals</a> or invite a remote agent below.
        </p>
      {:else}
        <p class="picker-empty">No matching terminal. Refine your search or pick from the full list by clearing the field.</p>
      {/if}
    {/each}
  </div>

  <button
    type="submit"
    class="primary"
    disabled={formState !== 'handleBeingTyped'}
  >
    {#if formState === 'submittingToServer'}
      Inviting…
    {:else}
      Send invite
    {/if}
  </button>
</form>

<style>
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

  .suggestion-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip {
    display: inline-flex;
    flex-direction: column;
    align-items: flex-start;
    padding: 0.45rem 0.7rem;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    cursor: pointer;
    text-align: left;
  }

  .chip:hover:not(:disabled) {
    border-color: var(--accent);
  }

  .chip-handle {
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-strong);
  }

  .picker-empty {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .picker-empty a {
    color: var(--accent);
    text-decoration: underline;
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
</style>
