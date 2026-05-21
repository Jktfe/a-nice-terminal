<!--
  RemoveMemberFlow — orchestrates the destructive remove confirm + DELETE
  call for one member. Extracted from rooms/[roomId]/+page.svelte to keep
  that page under its 260-line cap.

  Parent sets memberPendingRemoval to a RoomMember when the user picks
  Remove from the participant sheet. The flow mounts the confirm modal,
  on confirm calls DELETE /api/chat-rooms/:roomId/members?globalHandle=,
  then calls onRemoved so the parent can refresh the room view. On
  cancel or error the flow surfaces a clear message and clears state.
-->
<script lang="ts">
  import RemoveMemberConfirmModal from './RemoveMemberConfirmModal.svelte';
  import type { RoomMember } from '$lib/server/chatRoomStore';

  type Props = {
    roomId: string;
    memberPendingRemoval: RoomMember | null;
    onRemoved: () => void;
    onCancelled: () => void;
  };

  let { roomId, memberPendingRemoval, onRemoved, onCancelled }: Props = $props();

  let removeError = $state('');

  function restoreFocusToMemberRow(globalHandle: string) {
    // The participant row stays mounted while the modal is open, so we can
    // find it via the data-member-handle attribute and hand keyboard focus
    // back to the row the user originally activated. Document.activeElement
    // capture inside the modal cannot help here because the detail sheet
    // has already unmounted by the time the modal mounts.
    setTimeout(() => {
      const row = document.querySelector(`[data-member-handle="${globalHandle}"]`);
      if (row instanceof HTMLElement) row.focus();
    }, 0);
  }

  async function confirmRemoveMember() {
    if (!memberPendingRemoval) return;
    const handleToRemove = memberPendingRemoval.handle;
    removeError = '';
    try {
      const response = await fetch(
        `/api/chat-rooms/${roomId}/members?globalHandle=${encodeURIComponent(handleToRemove)}`,
        { method: 'DELETE' }
      );
      if (response.status === 409) {
        const body = await response.json().catch(() => ({ message: 'Cannot remove this member.' }));
        removeError = body.message ?? 'Cannot remove this member.';
        restoreFocusToMemberRow(handleToRemove);
        return;
      }
      if (!response.ok) {
        removeError = `Could not remove ${handleToRemove}.`;
        restoreFocusToMemberRow(handleToRemove);
        return;
      }
      onRemoved();
    } catch {
      removeError = `Could not remove ${handleToRemove}.`;
      restoreFocusToMemberRow(handleToRemove);
    }
  }

  function cancelRemoveMember() {
    const handleToRestore = memberPendingRemoval?.handle;
    removeError = '';
    onCancelled();
    if (handleToRestore) restoreFocusToMemberRow(handleToRestore);
  }
</script>

{#if memberPendingRemoval}
  <RemoveMemberConfirmModal
    memberHandle={memberPendingRemoval.handle}
    onConfirm={confirmRemoveMember}
    onCancel={cancelRemoveMember}
  />
  {#if removeError}
    <p class="remove-error" role="alert">{removeError}</p>
  {/if}
{/if}

<style>
  .remove-error {
    position: fixed;
    bottom: 1.5rem;
    left: 50%;
    transform: translateX(-50%);
    margin: 0;
    padding: 0.6rem 1rem;
    background: #c92020;
    color: white;
    border-radius: 0.5rem;
    z-index: 1002;
    font-size: 0.85rem;
  }
</style>
