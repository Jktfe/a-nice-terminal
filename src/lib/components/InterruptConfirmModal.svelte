<!-- Confirm one-shot terminal/session interrupt. This sends ESC only; it does not kill the terminal or post a context break. -->
<script lang="ts">
  type Props = {
    open: boolean;
    targetLabel: string;
    onCancel: () => void;
    onConfirm: () => void | Promise<void>;
  };

  let { open, targetLabel, onCancel, onConfirm }: Props = $props();
  let confirming = $state(false);

  async function handleConfirm(): Promise<void> {
    if (confirming) return;
    confirming = true;
    try {
      await onConfirm();
    } finally {
      confirming = false;
    }
  }
</script>

{#if open}
  <div class="interrupt-backdrop" role="dialog" aria-modal="true" aria-label="Interrupt terminal">
    <form class="interrupt-card" onsubmit={(event) => { event.preventDefault(); void handleConfirm(); }}>
      <h2>Interrupt terminal?</h2>
      <p>
        Send <code>Esc</code> to <code>{targetLabel}</code> so the running agent or terminal app stops its current action.
        This does not kill the terminal or create a context break.
      </p>
      <div class="actions">
        <button type="button" class="secondary" onclick={onCancel} disabled={confirming}>Cancel</button>
        <button type="submit" class="interrupt" disabled={confirming}>
          {confirming ? 'Sending…' : 'Send Esc'}
        </button>
      </div>
    </form>
  </div>
{/if}

<style>
  .interrupt-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    background: rgba(0, 0, 0, 0.45);
  }
  .interrupt-card {
    display: grid;
    gap: 0.8rem;
    width: 100%;
    max-width: 28rem;
    padding: 1.5rem;
    border: 1px solid var(--accent, #c63b3b);
    border-radius: 0.8rem;
    background: var(--surface-card);
  }
  h2 {
    margin: 0;
    color: var(--accent, #c63b3b);
    font-size: 1.05rem;
  }
  p {
    margin: 0;
    color: var(--ink-strong);
    font-size: 0.9rem;
    line-height: 1.4;
  }
  code {
    padding: 0.1rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--bg);
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
  }
  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  button {
    padding: 0.5rem 1.1rem;
    border-radius: 999px;
    font-weight: 800;
    cursor: pointer;
  }
  .secondary {
    border: 1px solid var(--line-soft);
    background: var(--bg);
    color: var(--ink-strong);
  }
  .interrupt {
    border: 1px solid var(--accent, #c63b3b);
    background: var(--accent, #c63b3b);
    color: white;
  }
  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
