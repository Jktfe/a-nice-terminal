<!--
  TerminalSpecialKeys.svelte — FRONT-3v2-1 per design 2026-05-14.
  Horizontal button strip lifting v3 SPECIAL_KEYS. Each button forwards its
  ANSI sequence to onKey(seq). The Paste sentinel is intercepted here:
  reads navigator.clipboard, forwards the clipboard text instead.

  Mount surface: above the xterm host in Raw view. Optional: ChatView can
  reuse this above its composer for parity.
-->
<script lang="ts">
  import { SPECIAL_KEYS, PASTE_SENTINEL } from '$lib/terminal/specialKeys';

  type Props = {
    onKey: (seq: string) => void;
    onPasteError?: (err: unknown) => void;
  };
  let { onKey, onPasteError }: Props = $props();

  async function handleClick(seq: string): Promise<void> {
    if (seq !== PASTE_SENTINEL) {
      onKey(seq);
      return;
    }
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      onPasteError?.(new Error('clipboard unavailable'));
      return;
    }
    try {
      const text = await navigator.clipboard.readText();
      if (text.length > 0) onKey(text);
    } catch (cause) {
      onPasteError?.(cause);
    }
  }
</script>

<nav class="special-keys" aria-label="Terminal special keys">
  {#each SPECIAL_KEYS as key (key.cli)}
    <button
      type="button"
      class="key-btn"
      data-cli={key.cli}
      onclick={() => void handleClick(key.seq)}
      title={key.cli}
    >{key.label}</button>
  {/each}
</nav>

<style>
  .special-keys {
    display: flex; flex-wrap: wrap; gap: 0.3rem;
    padding: 0.4rem 0.6rem;
    background: var(--surface-card);
    border-bottom: 1px solid var(--line-soft);
  }
  .key-btn {
    padding: 0.25rem 0.55rem; border-radius: 0.35rem;
    border: 1px solid var(--line-soft);
    background: var(--bg); color: var(--ink-strong);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem; cursor: pointer;
    min-width: 1.8rem;
  }
  .key-btn:hover { border-color: var(--ink-soft); }
  .key-btn[data-cli="ctrl-c"] { color: var(--accent); }
  .key-btn[data-cli="paste"] { color: var(--accent); font-weight: 700; }
</style>
