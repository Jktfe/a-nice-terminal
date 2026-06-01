<!--
  KillConfirmModal — destructive-action confirmation modal.
  Refactored to ModalShell. Preserves exact API.
-->
<script lang="ts">
  import ModalShell from './ModalShell.svelte';

  type TargetKind = 'ant-terminal' | 'tmux-pane';
  type KillMode = 'archive' | 'delete' | 'just-kill';
  type Props = {
    open: boolean;
    targetKind: TargetKind;
    targetLabel: string;
    onCancel: () => void;
    onConfirm: (mode: KillMode, rememberChoice: boolean) => void | Promise<void>;
    allowRemember?: boolean;
  };
  let { open, targetKind, targetLabel, onCancel, onConfirm, allowRemember = false }: Props = $props();
  let confirming = $state<KillMode | null>(null);
  let rememberChoice = $state(false);

  async function handleConfirm(mode: KillMode): Promise<void> {
    if (confirming !== null) return;
    confirming = mode;
    try { await onConfirm(mode, rememberChoice); }
    finally { confirming = null; }
  }

  $effect(() => {
    if (open) rememberChoice = false;
  });
</script>

<ModalShell {open} {onCancel} size="default">
  {#snippet title()}Kill {targetKind === 'ant-terminal' ? 'terminal' : 'tmux pane'}?{/snippet}

  <p class="muted">
    This stops the tmux session for <code>{targetLabel}</code>. Process state is lost.
  </p>
  {#if targetKind === 'ant-terminal'}
    <p class="muted">Choose what happens to the linked chat + ANT record:</p>
    <ul class="mode-list">
      <li><strong>Just Kill</strong> — process dies, terminal entry + linked chat stay live so you can re-attach.</li>
      <li><strong>Archive</strong> — hides from the terminals list, keeps the transcript so we can mine memories from it later via the vault.</li>
      <li><strong>Delete</strong> — soft-deletes the linked chat and removes the terminal record. Cannot be mined later.</li>
    </ul>
    {#if allowRemember}
      <label class="remember-row">
        <input type="checkbox" bind:checked={rememberChoice} disabled={confirming !== null} />
        <span>Remember my choice — skip this modal next time for this terminal.</span>
      </label>
    {/if}
  {/if}

  {#snippet actions()}
    <button type="button" class="secondary" onclick={onCancel} disabled={confirming !== null}>
      Cancel
    </button>
    {#if targetKind === 'ant-terminal'}
      <button type="button" class="just-kill" onclick={() => void handleConfirm('just-kill')} disabled={confirming !== null}>
        {confirming === 'just-kill' ? 'Killing…' : 'Just Kill'}
      </button>
      <button type="button" class="archive" onclick={() => void handleConfirm('archive')} disabled={confirming !== null}>
        {confirming === 'archive' ? 'Killing…' : 'Kill + Archive'}
      </button>
    {/if}
    <button type="button" class="destructive" onclick={() => void handleConfirm('delete')} disabled={confirming !== null}>
      {confirming === 'delete' ? 'Killing…' : (targetKind === 'ant-terminal' ? 'Kill + Delete' : 'Kill')}
    </button>
  {/snippet}
</ModalShell>

<style>
  .muted { margin: 0; color: var(--ink-strong); font-size: 0.9rem; line-height: 1.4; }
  code {
    background: var(--bg); padding: 0.1rem 0.35rem; border-radius: 0.3rem;
    font-family: ui-monospace, monospace; font-size: 0.85rem;
  }
  .mode-list {
    margin: 0; padding-left: 1.1rem;
    color: var(--ink-strong); font-size: 0.85rem; line-height: 1.5;
  }
  .mode-list li { margin-bottom: 0.25rem; }
  .remember-row {
    display: flex; align-items: center; gap: 0.5rem;
    padding: 0.5rem 0.7rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong); font-size: 0.82rem;
    cursor: pointer;
  }
  .remember-row input[type="checkbox"] {
    width: 1rem; height: 1rem;
    accent-color: var(--accent, #c63b3b);
    cursor: pointer;
  }
  button {
    padding: 0.5rem 1.1rem; border-radius: 999px;
    font-weight: 800; cursor: pointer;
  }
  .secondary {
    border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong);
    font-weight: 700;
  }
  .just-kill {
    border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong);
    font-weight: 800;
  }
  .just-kill:hover { border-color: var(--ink-strong); }
  .archive {
    border: 1px solid var(--line-soft); background: var(--surface-card); color: var(--ink-strong);
    font-weight: 800;
  }
  .archive:hover { border-color: var(--ink-strong); }
  .destructive {
    border: 1px solid var(--accent, #c63b3b); background: var(--accent, #c63b3b);
    color: white; font-weight: 800;
  }
  button:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
