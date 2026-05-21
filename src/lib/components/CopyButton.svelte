<!--
  CopyButton — small reusable copy-to-clipboard button. Single text
  prop, optional label snippet. Shows a "Copied" pill for 2s after a
  successful write. Falls back to a textarea+execCommand path when the
  browser refuses navigator.clipboard (e.g. insecure context).
-->
<script lang="ts">
  import type { Snippet } from 'svelte';

  type Props = {
    text: string;
    label?: string;
    variant?: 'primary' | 'subtle';
    title?: string;
    children?: Snippet;
  };

  let { text, label = 'Copy', variant = 'subtle', title, children }: Props = $props();

  let copied = $state(false);
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copy(): Promise<void> {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
      }
      copied = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { copied = false; }, 2000);
    } catch {
      // Swallow — user can still select the visible text.
    }
  }
</script>

<button
  type="button"
  class={`copy ${variant}`}
  class:copied
  onclick={copy}
  title={title ?? `Copy: ${text}`}
  aria-label={title ?? `Copy ${label}`}
>
  {#if copied}
    Copied
  {:else if children}
    {@render children()}
  {:else}
    {label}
  {/if}
</button>

<style>
  .copy {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    padding: 0.35rem 0.7rem;
    border-radius: 0.45rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-size: 0.78rem;
    font-weight: 700;
    cursor: pointer;
    transition: background 120ms, border-color 120ms, color 120ms;
  }
  .copy:hover { border-color: var(--accent); color: var(--accent); }
  .copy.primary {
    background: var(--accent);
    border-color: var(--accent);
    color: white;
  }
  .copy.primary:hover { background: color-mix(in srgb, var(--accent) 80%, black); color: white; }
  .copy.copied {
    background: var(--ok);
    border-color: var(--ok);
    color: white;
  }
</style>
