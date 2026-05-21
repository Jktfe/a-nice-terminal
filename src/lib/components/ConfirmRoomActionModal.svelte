<!--
  ConfirmRoomActionModal — confirm before a destructive-ish room action.
  Refactored to ModalShell. Preserves exact API.
-->
<script lang="ts">
  import ModalShell from './ModalShell.svelte';

  type RoomAction = 'archive' | 'delete';

  type Props = {
    open: boolean;
    action: RoomAction;
    roomName: string;
    messageCount?: number;
    onCancel: () => void;
    onConfirm: () => Promise<void> | void;
  };

  let { open, action, roomName, messageCount, onCancel, onConfirm }: Props = $props();
  let isPending = $state(false);

  async function handleConfirmClick() {
    if (isPending) return;
    isPending = true;
    try {
      await onConfirm();
    } finally {
      isPending = false;
    }
  }

  const title = $derived(
    action === 'delete' ? `Delete "${roomName}"?` : `Archive "${roomName}"?`
  );

  const disclaimer = $derived(
    action === 'delete'
      ? 'This is reversible — the room is soft-deleted, not destroyed.'
      : 'Archived rooms are hidden from your default room list. You can restore later.'
  );

  const confirmLabel = $derived(action === 'delete' ? 'Delete' : 'Archive');
  const pendingLabel = $derived(action === 'delete' ? 'Deleting…' : 'Archiving…');
</script>

<ModalShell {open} {onCancel} size="default" data-testid="confirm-room-action-modal">
  {#snippet title()}{title}{/snippet}

  {#if typeof messageCount === 'number'}
    <p>It has {messageCount} messages.</p>
  {/if}
  <p class="disclaimer">{disclaimer}</p>

  {#snippet actions()}
    <!-- svelte-ignore a11y_autofocus -->
    <button type="button" class="safe" onclick={onCancel} autofocus>Cancel</button>
    <button
      type="button"
      class="primary"
      class:destructive={action === 'delete'}
      class:archive={action === 'archive'}
      onclick={handleConfirmClick}
      disabled={isPending}
    >
      {isPending ? pendingLabel : confirmLabel}
    </button>
  {/snippet}
</ModalShell>

<style>
  p {
    margin: 0;
    line-height: 1.45;
  }
  .disclaimer {
    color: var(--ink-strong);
    opacity: 0.72;
    font-size: 0.92rem;
  }
  button {
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    font: inherit;
    font-weight: 800;
    font-size: 0.95rem;
    cursor: pointer;
  }
  button.safe {
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink-strong);
  }
  button.primary {
    border: none;
    color: white;
  }
  button.primary.destructive {
    background: var(--warn, #c92020);
  }
  button.primary.archive {
    background: var(--accent);
  }
  button.primary:hover:not(:disabled) {
    filter: brightness(1.05);
  }
  button.primary:disabled {
    opacity: 0.65;
    cursor: progress;
  }
</style>
