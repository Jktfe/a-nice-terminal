<!--
  QuickNavShortcuts — vim-style g-prefix nav keys for power users.

  Hold-then-tap pattern: press `g` (release), then within 1.2s press
  one of the destination keys to navigate.

    g d  → /            (Dashboard)
    g r  → /rooms
    g p  → /plans
    g t  → /terminals
    g s  → /search
    g a  → /asks
    g v  → /policies    (verification)
    g h  → opens the ? shortcuts overlay

  Same skip-when-typing rules as the ? overlay: input/textarea/contentEditable
  focus suppresses the shortcut. Sequences are cancelled on Esc or
  timeout, and `g` doesn't fire if any modifier is held (so Cmd-G search
  still works).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  const DESTINATIONS: Record<string, string> = {
    d: '/',
    r: '/rooms',
    p: '/plans',
    t: '/terminals',
    s: '/search',
    a: '/asks',
    v: '/policies',
    c: '/chair',
    m: '/memory'
  };

  let awaitingDestination = $state(false);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    if (target.isContentEditable) return true;
    const tag = target.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  function cancelSequence() {
    awaitingDestination = false;
    if (timeoutHandle !== null) {
      clearTimeout(timeoutHandle);
      timeoutHandle = null;
    }
  }

  function startSequence() {
    awaitingDestination = true;
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(cancelSequence, 1200);
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (isTypingTarget(event.target)) {
      cancelSequence();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) {
      cancelSequence();
      return;
    }
    if (event.key === 'Escape' && awaitingDestination) {
      event.preventDefault();
      cancelSequence();
      return;
    }
    if (awaitingDestination) {
      const key = event.key.toLowerCase();
      const destination = DESTINATIONS[key];
      if (destination) {
        event.preventDefault();
        cancelSequence();
        void goto(destination);
        return;
      }
      // Any other key cancels the sequence so the user doesn't get
      // stuck in nav-mode after a typo.
      cancelSequence();
      return;
    }
    if (event.key === 'g' && !event.shiftKey) {
      // Don't fire if focus is on a button that's about to act on 'g'
      // (rare — but defensive).
      event.preventDefault();
      startSequence();
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    };
  });
</script>

{#if awaitingDestination}
  <!-- Toast-style hint at the bottom-right so the user knows the
       g-sequence is in flight and what their options are. -->
  <div class="nav-hint" role="status" aria-live="polite">
    <strong>g →</strong>
    <span><kbd>d</kbd> dashboard</span>
    <span><kbd>r</kbd> rooms</span>
    <span><kbd>p</kbd> plans</span>
    <span><kbd>t</kbd> terminals</span>
    <span><kbd>s</kbd> search</span>
    <span><kbd>a</kbd> asks</span>
    <span><kbd>v</kbd> policies</span>
    <span><kbd>c</kbd> chair</span>
    <span><kbd>esc</kbd> cancel</span>
  </div>
{/if}

<style>
  .nav-hint {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 1002;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.7rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 0.78rem;
    box-shadow: 0 8px 28px rgb(0 0 0 / 16%);
    max-width: min(720px, calc(100vw - 2rem));
    animation: nav-hint-pop 0.14s ease-out;
  }
  .nav-hint strong {
    color: var(--accent);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .nav-hint span {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    color: var(--ink-soft);
  }
  .nav-hint kbd {
    display: inline-block;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 700;
  }
  @keyframes nav-hint-pop {
    from { transform: translateY(8px) scale(0.97); opacity: 0; }
    to { transform: translateY(0) scale(1); opacity: 1; }
  }
  @media (prefers-reduced-motion: reduce) {
    .nav-hint { animation: none; }
  }
</style>
