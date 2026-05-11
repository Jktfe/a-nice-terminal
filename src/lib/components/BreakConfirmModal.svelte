<!--
  BreakConfirmModal — replaces window.confirm() on the /break composer
  path. iOS PWA standalone mode does not always render native browser
  dialogs (window.confirm silently returns false in some configs),
  which left James's break markers never reaching writeMessage and
  the visual divider never rendering. This modal works consistently
  on desktop and mobile, focuses the reason field, and supports
  keyboard Escape / Enter shortcuts.

  Triggered from MessageInput.svelte when detectBreakCommand sees
  `/break [reason]`. Caller passes the parsed reason as the initial
  textarea value; user can edit before confirming.
-->
<script lang="ts">
  let {
    open = false,
    initialReason = '',
    onConfirm,
    onCancel,
  }: {
    open?: boolean;
    initialReason?: string;
    onConfirm: (reason: string) => void;
    onCancel?: () => void;
  } = $props();

  let reason = $state('');
  let textareaEl = $state<HTMLTextAreaElement | null>(null);

  // Sync reason from prop whenever the modal opens — keeps the
  // edited text fresh each /break attempt rather than carrying over
  // a previous draft.
  $effect(() => {
    if (open) {
      reason = initialReason;
      // Focus the textarea after the dialog renders so the user can
      // immediately type/edit. queueMicrotask so the DOM has settled.
      queueMicrotask(() => {
        textareaEl?.focus();
        textareaEl?.select();
      });
    }
  });

  function cancel() {
    onCancel?.();
  }

  function confirm() {
    onConfirm(reason.trim());
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      confirm();
    }
  }

  function handleOverlayClick(e: MouseEvent) {
    // Clicking the overlay (not the dialog content) closes the modal.
    if (e.target === e.currentTarget) cancel();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div
    class="break-modal-overlay"
    role="presentation"
    onclick={handleOverlayClick}
    onkeydown={handleKeydown}
  >
    <div
      class="break-modal-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="break-modal-title"
      aria-describedby="break-modal-desc"
    >
      <h2 id="break-modal-title" class="break-modal-title">Post a context break?</h2>
      <p id="break-modal-desc" class="break-modal-desc">
        Agents will only see messages posted <strong>after</strong> this
        break. Older context stays in the chat for humans but is hidden
        from any new agent prompts. Add a reason so you remember
        what changed.
      </p>

      <label class="break-modal-label" for="break-modal-reason">
        Reason (optional)
      </label>
      <textarea
        id="break-modal-reason"
        bind:this={textareaEl}
        bind:value={reason}
        rows="3"
        placeholder="What's the new direction?"
        class="break-modal-textarea"
        onkeydown={handleKeydown}
      ></textarea>

      <div class="break-modal-actions">
        <button type="button" class="break-modal-btn break-modal-btn--ghost" onclick={cancel}>
          Cancel
        </button>
        <button type="button" class="break-modal-btn break-modal-btn--primary" onclick={confirm}>
          Post break
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .break-modal-overlay {
    position: fixed;
    inset: 0;
    z-index: 9999;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 16px;
    background: rgba(15, 23, 42, 0.45);
    backdrop-filter: blur(2px);
  }

  .break-modal-dialog {
    width: 100%;
    max-width: 480px;
    padding: 20px;
    border-radius: 12px;
    background: var(--bg-card, #fff);
    box-shadow: 0 18px 40px rgba(15, 23, 42, 0.22);
    border: 1px solid var(--border-subtle, rgba(0, 0, 0, 0.08));
    color: var(--text, #111827);
  }

  .break-modal-title {
    margin: 0 0 8px;
    font-size: 17px;
    font-weight: 700;
    line-height: 1.2;
  }

  .break-modal-desc {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.45;
    color: var(--text-muted, #4b5563);
  }

  .break-modal-label {
    display: block;
    margin-bottom: 6px;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted, #4b5563);
  }

  .break-modal-textarea {
    width: 100%;
    min-height: 72px;
    padding: 9px 11px;
    border: 1px solid var(--border-subtle, #d1d5db);
    border-radius: 8px;
    background: var(--bg, #fff);
    color: var(--text, #111827);
    font-size: 14px;
    font-family: inherit;
    line-height: 1.4;
    resize: vertical;
    box-sizing: border-box;
  }

  .break-modal-textarea:focus {
    outline: none;
    border-color: var(--accent-blue, #2563eb);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent-blue, #2563eb) 18%, transparent);
  }

  .break-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 8px;
    margin-top: 16px;
  }

  .break-modal-btn {
    min-height: 40px;
    padding: 9px 16px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    border: 1px solid transparent;
    font-family: inherit;
    line-height: 1;
  }

  .break-modal-btn--ghost {
    background: transparent;
    color: var(--text, #111827);
    border-color: var(--border-subtle, #d1d5db);
  }

  .break-modal-btn--ghost:hover {
    background: var(--bg-hover, rgba(0, 0, 0, 0.04));
  }

  .break-modal-btn--primary {
    background: var(--accent-blue, #2563eb);
    color: #fff;
    border-color: var(--accent-blue, #2563eb);
  }

  .break-modal-btn--primary:hover {
    background: color-mix(in srgb, var(--accent-blue, #2563eb) 88%, #000);
  }

  /* Mobile: full-bleed padding, larger touch targets */
  @media (max-width: 640px) {
    .break-modal-overlay {
      padding: 12px;
      align-items: flex-end;
    }

    .break-modal-dialog {
      max-width: none;
      border-radius: 16px 16px 12px 12px;
    }

    .break-modal-btn {
      min-height: 44px;
    }
  }
</style>
