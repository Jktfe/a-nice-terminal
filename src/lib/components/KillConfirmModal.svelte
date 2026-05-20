<!--
  KillConfirmModal.svelte — destructive-action confirmation modal per
  docs/terminal-kill-stop-ux-2026-05-14.md KILL-1 slice + JWPK kill+archive/
  kill+delete extension (msg_kjyh3lmypd 2026-05-18) + Just Kill / per-
  terminal default disposition (msg_t42mq5ma6u 2026-05-19).

  Reusable for ant-terminal + bare-tmux-pane kill flows.

  Three actions for ant-terminals: Just Kill (process dies, record + linked
  chat stay live for re-attach), Kill+Archive (default; keeps transcript +
  linked-chat history for retrieval), Kill+Delete (drops transcript,
  linked-chat, terminal record).

  bare-tmux-panes get a single Kill button — they have no linked chat or
  terminal record to act on, so the disposition choice is moot.

  When `allowRemember` is true (ant-terminal targets only), a checkbox lets
  the operator save the picked mode as the default disposition so the modal
  is skipped next time. The parent receives the chosen mode + remember flag
  via onConfirm(mode, rememberChoice).
-->
<script lang="ts">
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

  // Reset the remember-choice toggle whenever the modal re-opens so a
  // previous session's tick doesn't survive into a fresh confirmation.
  $effect(() => {
    if (open) rememberChoice = false;
  });
</script>

{#if open}
  <div class="kill-backdrop" role="dialog" aria-modal="true" aria-label={`Kill ${targetKind}`}>
    <div class="kill-card">
      <h2>Kill {targetKind === 'ant-terminal' ? 'terminal' : 'tmux pane'}?</h2>
      <p class="muted">
        This stops the tmux session for <code>{targetLabel}</code>. Process state is lost.
      </p>
      {#if targetKind === 'ant-terminal'}
        <p class="muted">
          Choose what happens to the linked chat + ANT record:
        </p>
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
      <div class="actions">
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
      </div>
    </div>
  </div>
{/if}

<style>
  .kill-backdrop {
    position: fixed; inset: 0; z-index: 1100;
    background: rgba(0,0,0,0.5);
    display: flex; align-items: center; justify-content: center;
    padding: 1rem;
  }
  .kill-card {
    background: var(--surface-card); border: 1px solid var(--accent, #c63b3b);
    border-radius: 0.8rem; padding: 1.5rem; max-width: 28rem; width: 100%;
    display: grid; gap: 0.8rem;
  }
  .kill-card h2 { margin: 0; color: var(--accent, #c63b3b); font-size: 1.05rem; }
  .kill-card .muted { margin: 0; color: var(--ink-strong); font-size: 0.9rem; line-height: 1.4; }
  .kill-card code {
    background: var(--bg); padding: 0.1rem 0.35rem; border-radius: 0.3rem;
    font-family: ui-monospace, monospace; font-size: 0.85rem;
  }
  .kill-card .mode-list {
    margin: 0; padding-left: 1.1rem;
    color: var(--ink-strong); font-size: 0.85rem; line-height: 1.5;
  }
  .kill-card .mode-list li { margin-bottom: 0.25rem; }
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
  .kill-card .actions { display: flex; justify-content: flex-end; gap: 0.5rem; flex-wrap: wrap; }
  .kill-card .secondary {
    padding: 0.5rem 1.1rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong);
    font-weight: 700; cursor: pointer;
  }
  .kill-card .just-kill {
    padding: 0.5rem 1.1rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--bg); color: var(--ink-strong);
    font-weight: 800; cursor: pointer;
  }
  .kill-card .just-kill:hover { border-color: var(--ink-strong); }
  .kill-card .archive {
    padding: 0.5rem 1.1rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--surface-card); color: var(--ink-strong);
    font-weight: 800; cursor: pointer;
  }
  .kill-card .archive:hover { border-color: var(--ink-strong); }
  .kill-card .destructive {
    padding: 0.5rem 1.1rem; border-radius: 999px;
    border: 1px solid var(--accent, #c63b3b); background: var(--accent, #c63b3b);
    color: white; font-weight: 800; cursor: pointer;
  }
  .kill-card button:disabled { opacity: 0.55; cursor: not-allowed; }
</style>
