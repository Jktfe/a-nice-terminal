<!--
  ConfirmRoomActionModal — confirm before a destructive-ish room action.

  Generalised from ConfirmDeleteRoomModal (2026-05-15). The `action` prop
  picks the copy + button style:
    - 'delete'  → hard-confirm: "Delete '<name>'?" + soft-delete disclaimer
    - 'archive' → soft-confirm: "Archive '<name>'?" + recoverable disclaimer

  Pure presentation: parent (RoomStrip) wires `onConfirm` to do the fetch
  and flips `open` to mount/dismiss.

  Implementation notes:
  - Uses <dialog> + showModal()/close() driven by the `open` prop via $effect
    for accessible-by-default focus trap + Escape dismissal.
  - Backdrop click is detected via the dialog's own click handler comparing
    event.target === dialog (clicks on inner children bubble through dialog
    but with event.target set to the child).
  - Cancel is the default-focused button (autofocus on the Cancel button).
  - The action button shows a pending state while onConfirm's promise resolves;
    it is disabled during that window to prevent double-fire.
-->
<script lang="ts">
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

  let dialogElement = $state<HTMLDialogElement | null>(null);
  let isPending = $state(false);

  $effect(() => {
    if (!dialogElement) return;
    if (open && !dialogElement.open) {
      dialogElement.showModal();
    } else if (!open && dialogElement.open) {
      dialogElement.close();
    }
  });

  function handleBackdropClick(event: MouseEvent) {
    if (event.target === dialogElement) {
      onCancel();
    }
  }

  function handleCancelEvent(event: Event) {
    event.preventDefault();
    onCancel();
  }

  async function handleConfirmClick() {
    if (isPending) return;
    isPending = true;
    try {
      await onConfirm();
    } finally {
      isPending = false;
    }
  }

  const headingId = 'confirmRoomActionHeading';

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

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogElement}
  class="confirm-room-action-dialog"
  data-action={action}
  aria-labelledby={headingId}
  onclick={handleBackdropClick}
  oncancel={handleCancelEvent}
>
  <h2 id={headingId}>{title}</h2>
  <div class="body">
    {#if typeof messageCount === 'number'}
      <p>It has {messageCount} messages.</p>
    {/if}
    <p class="disclaimer">{disclaimer}</p>
  </div>
  <div class="actions">
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
  </div>
</dialog>

<style>
  .confirm-room-action-dialog {
    width: min(420px, calc(100vw - 2rem));
    padding: 1.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    box-shadow: var(--shadow-card);
  }

  .confirm-room-action-dialog::backdrop {
    background: rgb(0 0 0 / 40%);
  }

  h2 {
    margin: 0 0 0.9rem;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }

  .body {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    margin-bottom: 1.2rem;
  }

  .body p {
    margin: 0;
    line-height: 1.45;
  }

  .disclaimer {
    color: var(--ink-strong);
    opacity: 0.72;
    font-size: 0.92rem;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
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
