<!--
  BreakConfirmModal — confirm that the user wants to post a context break.
  Backs M12 break-context.

  Why a modal: a break is irreversible inside the agent context window — every
  agent reading the room from this point on will only see messages AFTER the
  break. The native window.confirm fails silently inside iOS PWA standalone
  mode, so this is the cross-platform replacement.
-->
<script lang="ts">
  type Props = {
    isOpen: boolean;
    reasonTyped: string;
    onConfirm: () => void;
    onCancel: () => void;
    onReasonInput: (newReason: string) => void;
  };

  let { isOpen, reasonTyped, onConfirm, onCancel, onReasonInput }: Props = $props();

  function handleKeyDown(keyboardEvent: KeyboardEvent) {
    if (!isOpen) return;
    if (keyboardEvent.key === 'Escape') {
      keyboardEvent.preventDefault();
      onCancel();
      return;
    }
    if (keyboardEvent.key === 'Enter' && (keyboardEvent.metaKey || keyboardEvent.ctrlKey)) {
      keyboardEvent.preventDefault();
      onConfirm();
    }
  }
</script>

<svelte:window onkeydown={handleKeyDown} />

{#if isOpen}
  <div class="break-modal-backdrop">
    <button
      type="button"
      class="backdrop-dismisser"
      aria-label="Close break confirmation"
      onclick={onCancel}
    ></button>
    <div
      class="break-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="breakModalHeading"
      tabindex="-1"
    >
      <h2 id="breakModalHeading">Post a context break?</h2>
      <p>
        Agents will only see messages posted after this break. Older context
        stays visible to humans.
      </p>

      <label for="breakReasonField">Reason (optional)</label>
      <input
        id="breakReasonField"
        type="text"
        autocomplete="off"
        placeholder="e.g. starting the next sprint"
        value={reasonTyped}
        oninput={(event) => onReasonInput(event.currentTarget.value)}
      />

      <div class="break-modal-actions">
        <button type="button" class="cancel" onclick={onCancel}>Cancel</button>
        <button type="button" class="primary" onclick={onConfirm}>Post break</button>
      </div>

      <p class="hint">Cmd-Enter to post · Esc to cancel</p>
    </div>
  </div>
{/if}

<style>
  .break-modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(10, 10, 14, 0.45);
    display: grid;
    place-items: center;
    z-index: 1000;
    padding: 1rem;
  }

  .backdrop-dismisser {
    position: absolute;
    inset: 0;
    background: transparent;
    border: 0;
    padding: 0;
    cursor: pointer;
  }

  .break-modal {
    position: relative;
    width: min(420px, 100%);
    padding: 1.4rem 1.5rem;
    background: var(--surface);
    border-radius: 1rem;
    border: 1px solid var(--surface-edge);
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }

  h2 {
    margin: 0;
    font-size: 1.1rem;
    font-weight: 800;
    color: var(--ink-strong);
  }

  p {
    margin: 0;
    color: var(--ink-soft);
    line-height: 1.4;
  }

  label {
    margin-top: 0.4rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink);
  }

  input {
    padding: 0.6rem 0.8rem;
    font-size: 0.95rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    background: var(--bg);
    color: var(--ink-strong);
  }

  input:focus {
    outline: 2px solid var(--accent);
    outline-offset: 1px;
  }

  .break-modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.4rem;
  }

  button.cancel {
    padding: 0.5rem 1rem;
    background: transparent;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    color: var(--ink);
    font-weight: 700;
    cursor: pointer;
  }

  button.primary {
    padding: 0.5rem 1.1rem;
    background: var(--accent);
    color: white;
    border: none;
    border-radius: 999px;
    font-weight: 800;
    cursor: pointer;
  }

  .hint {
    margin: 0.3rem 0 0;
    font-size: 0.72rem;
    color: var(--ink-soft);
  }
</style>
