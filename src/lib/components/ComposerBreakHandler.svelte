<!--
  ComposerBreakHandler — owns the /break submission lifecycle.
  Extracted from ChatComposer.svelte for M03 slice 4 split-before-touch
  so ChatComposer can fit MentionAutocomplete under the 260-line cap.

  Lifts: BreakConfirmModal mount, break-state, confirmBreak fetch.
  Parent controls "is the modal open" via pendingBreakReason. When the
  parent sets pendingBreakReason to a string, the handler seeds the
  modal reason and opens the dialog. The parent clears the reason on
  cancel/success via onCancelled/onBreakPosted.
-->
<script lang="ts">
  import BreakConfirmModal from './BreakConfirmModal.svelte';
  import type { ChatMessage } from '$lib/server/chatMessageStore';

  type Props = {
    roomId: string;
    asHandle: string;
    pendingBreakReason: string | null;
    onBreakPosted?: (message?: ChatMessage) => void;
    onCancelled?: () => void;
    onError?: (errorMessage: string) => void;
  };

  let {
    roomId,
    asHandle,
    pendingBreakReason,
    onBreakPosted,
    onCancelled,
    onError
  }: Props = $props();

  let reasonInModal = $state('');
  let lastPendingSeen: string | null = null;

  $effect(() => {
    if (pendingBreakReason !== null && pendingBreakReason !== lastPendingSeen) {
      reasonInModal = pendingBreakReason;
    }
    lastPendingSeen = pendingBreakReason;
  });

  const modalIsOpen = $derived(pendingBreakReason !== null);

  async function confirmBreak() {
    try {
      const response = await fetch(`/api/chat-rooms/${roomId}/breaks`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: reasonInModal, postedByHandle: asHandle })
      });
      if (!response.ok) {
        const failurePayload = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failurePayload.message ?? 'Could not post the break.');
      }
      const payload = (await response.json().catch(() => ({}))) as { message?: ChatMessage };
      reasonInModal = '';
      onBreakPosted?.(payload.message);
    } catch (causeOfFailure) {
      const failureMessage =
        causeOfFailure instanceof Error ? causeOfFailure.message : 'Could not post the break.';
      onError?.(failureMessage);
    }
  }

  function cancelBreak() {
    onCancelled?.();
  }
</script>

<BreakConfirmModal
  isOpen={modalIsOpen}
  reasonTyped={reasonInModal}
  onConfirm={confirmBreak}
  onCancel={cancelBreak}
  onReasonInput={(newReason) => (reasonInModal = newReason)}
/>
