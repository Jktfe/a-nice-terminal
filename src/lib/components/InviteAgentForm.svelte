<!--
  InviteAgentForm — invite an agent (or human) into a chat room.
  Wireframe board UK7Pq in antv5-wireframes.pen (Claude lane, x=-6200 y=1200).

  Five states the form moves through:
    1. emptyComposerWaitingForHandle    } owned by InviteAgentFormLocalPicker
    2. handleBeingTyped                 }
    3. submittingToServer               }
    4. invitedSuccessfully    — outcome view rendered here
    5. failedToInvite         — outcome view rendered here

  Split out of a single 721-line file (2026-05-21) to fit the 600-line
  component cap. The local typed-handle flow lives in
  InviteAgentFormLocalPicker.svelte; the collapsible remote-mint flow
  lives in InviteAgentFormRemoteSection.svelte. Parent retains the
  success/failure outcome view because that's the only state shared
  across the two flows (and the only state needed by external callers
  via the onAgentInvited callback).
-->
<script lang="ts">
  import InviteAgentFormLocalPicker from './InviteAgentFormLocalPicker.svelte';
  import InviteAgentFormRemoteSection from './InviteAgentFormRemoteSection.svelte';

  type OutcomeState = 'composing' | 'invitedSuccessfully' | 'failedToInvite';

  type Props = {
    roomId: string;
    onAgentInvited?: (newAgentHandle: string) => void;
    /** Handles already in this room. The local-invite picker filters
     *  these out per JWPK msg_p40dikqhvl ("exclude agents that are
     *  already in the room"). Optional — when omitted no filtering
     *  happens (back-compat for callers that don't yet thread it). */
    existingMemberHandles?: string[];
  };

  let { roomId, onAgentInvited, existingMemberHandles = [] }: Props = $props();

  let outcome = $state<OutcomeState>('composing');
  let mostRecentlyInvitedHandle = $state('');
  let lastErrorMessage = $state('');
  // Bumped on "Try again" / "Invite someone else" to remount the picker
  // and reset its internal handleBeingTyped + formState back to empty.
  let pickerInstance = $state(0);

  function handleInviteSucceeded(invitedHandle: string) {
    mostRecentlyInvitedHandle = invitedHandle;
    lastErrorMessage = '';
    outcome = 'invitedSuccessfully';
    onAgentInvited?.(invitedHandle);
  }

  function handleInviteFailed(errorMessage: string) {
    lastErrorMessage = errorMessage;
    outcome = 'failedToInvite';
  }

  function startAnotherInvite() {
    outcome = 'composing';
    lastErrorMessage = '';
    pickerInstance += 1;
  }
</script>

<section class="invite-agent-form" aria-labelledby="inviteAgentHeading">
  <h2 id="inviteAgentHeading">Invite an agent</h2>

  {#if outcome === 'failedToInvite'}
    <p class="error-message" role="alert">{lastErrorMessage}</p>
    <button type="button" class="primary" onclick={startAnotherInvite}>Try again</button>
  {:else if outcome === 'invitedSuccessfully'}
    <p class="success-message" role="status">
      Invited <strong>{mostRecentlyInvitedHandle}</strong>. They are now a member of this room.
    </p>
    <button type="button" class="primary" onclick={startAnotherInvite}>Invite someone else</button>
  {:else}
    {#key pickerInstance}
      <InviteAgentFormLocalPicker
        {roomId}
        {existingMemberHandles}
        onInviteSucceeded={handleInviteSucceeded}
        onInviteFailed={handleInviteFailed}
      />
    {/key}

    <InviteAgentFormRemoteSection {roomId} />
  {/if}
</section>

<style>
  .invite-agent-form {
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
